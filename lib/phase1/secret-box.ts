import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { resolveCredentialKeyMaterial } from "@/lib/phase1/provider-secret-vault";

// Generic AES-256-GCM encryption for small secrets we store in AppState (e.g. a
// per-user RingCentral JWT). Reuses the same key material as the provider secret
// vault (SYNCORE_CREDENTIAL_ENCRYPTION_KEY) but produces a self-contained token so
// it can live in a single string column: v1.<iv>.<authTag>.<ciphertext> (base64url).
const algorithm = "aes-256-gcm";
const prefix = "v1.";

function encryptionKey() {
  return createHash("sha256").update(resolveCredentialKeyMaterial()).digest();
}

export function encryptSecretString(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return prefix + [iv.toString("base64url"), authTag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecretString(token: string): string {
  if (!isEncryptedSecret(token)) {
    throw new Error("Value is not an encrypted secret token.");
  }
  const [, ivPart, tagPart, ctPart] = token.split(".");
  if (!ivPart || !tagPart || !ctPart) {
    throw new Error("Malformed encrypted secret token.");
  }
  const decipher = createDecipheriv(algorithm, encryptionKey(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctPart, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

export function isEncryptedSecret(value: string | undefined | null): value is string {
  return typeof value === "string" && value.startsWith(prefix);
}
