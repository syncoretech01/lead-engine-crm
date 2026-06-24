import { createVerify, X509Certificate } from "node:crypto";

/**
 * Minimal Amazon SNS message signature verification (no SDK dependency). Used by
 * the SES webhook to reject spoofed bounce/complaint posts — a forged event could
 * otherwise suppress an arbitrary contact. Verifies the RSA signature against the
 * SNS signing certificate, with the cert host locked to amazonaws.com.
 */
export type SnsMessage = {
  Type: string;
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  Signature: string;
  SignatureVersion: string;
  SigningCertURL: string;
  Subject?: string;
  Token?: string;
  SubscribeURL?: string;
};

const SIGNING_KEYS_BY_TYPE: Record<string, string[]> = {
  Notification: ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"],
  SubscriptionConfirmation: ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"],
  UnsubscribeConfirmation: ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"]
};

/** Build the exact string SNS signed, per the documented key order + format. */
export function snsSigningString(message: SnsMessage): string {
  const keys = SIGNING_KEYS_BY_TYPE[message.Type];
  if (!keys) return "";

  let out = "";
  for (const key of keys) {
    const value = (message as Record<string, unknown>)[key];
    // Subject is only part of the signature when present.
    if (value === undefined || value === null) continue;
    out += `${key}\n${String(value)}\n`;
  }
  return out;
}

/** Only trust certificate / confirmation URLs hosted on AWS SNS over HTTPS. */
export function isValidSnsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(parsed.hostname);
  } catch {
    return false;
  }
}

const certificateCache = new Map<string, string>();

async function fetchCertificate(url: string): Promise<string | null> {
  const cached = certificateCache.get(url);
  if (cached) return cached;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const pem = await response.text();
    certificateCache.set(url, pem);
    return pem;
  } catch {
    return null;
  }
}

export async function verifySnsMessage(message: SnsMessage): Promise<boolean> {
  if (!message?.Signature || !message.SigningCertURL || !isValidSnsUrl(message.SigningCertURL)) {
    return false;
  }
  const signingString = snsSigningString(message);
  if (!signingString) return false;

  const certificate = await fetchCertificate(message.SigningCertURL);
  if (!certificate) return false;

  const algorithm = message.SignatureVersion === "2" ? "RSA-SHA256" : "RSA-SHA1";
  try {
    // Modern Node won't verify against a raw certificate — extract its public key.
    const publicKey = new X509Certificate(certificate).publicKey;
    const verifier = createVerify(algorithm);
    verifier.update(signingString, "utf8");
    verifier.end();
    return verifier.verify(publicKey, message.Signature, "base64");
  } catch {
    return false;
  }
}
