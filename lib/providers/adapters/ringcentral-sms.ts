import { providerError } from "@/lib/providers/adapters/http";
import type { ProviderRequestContext, ProviderResult } from "@/lib/providers/types";

export type RingCentralSmsCredential = {
  clientId: string;
  clientSecret: string;
  jwt: string;
  serverUrl: string;
};

export type RingCentralSmsInput = {
  fromNumber: string;
  toNumber: string;
  text: string;
};

export type RingCentralSmsResult = {
  providerMessageId?: string;
  status: "sent" | "failed";
  recipient: string;
  sentAt: string;
  reason?: string;
};

export type RingCentralFetch = (url: string, init?: RequestInit) => Promise<Response>;

const defaultServerUrl = "https://platform.ringcentral.com";
const jwtGrantType = "urn:ietf:params:oauth:grant-type:jwt-bearer";

export function ringCentralCredentialFromEnv(env: NodeJS.ProcessEnv = process.env): RingCentralSmsCredential | null {
  const credential = {
    clientId: env.RINGCENTRAL_CLIENT_ID ?? "",
    clientSecret: env.RINGCENTRAL_CLIENT_SECRET ?? "",
    jwt: env.RINGCENTRAL_JWT ?? "",
    serverUrl: env.RINGCENTRAL_SERVER_URL ?? defaultServerUrl
  };

  return credential.clientId && credential.clientSecret && credential.jwt ? credential : null;
}

export function ringCentralSmsLiveBlockReason(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.SYNCORE_ENABLE_LIVE_PROVIDERS !== "true") return "Live providers are disabled.";
  if (!ringCentralCredentialFromEnv(env)) return "RingCentral credentials are missing.";
  return undefined;
}

export async function ringCentralSendSms(
  input: unknown,
  context: ProviderRequestContext
): Promise<ProviderResult<RingCentralSmsResult>> {
  const { providerId, requestId } = context;
  const credential = parseCredential(context);
  if (!credential) {
    return providerError(
      providerId,
      requestId,
      "RingCentral credential is missing or malformed (need clientId, clientSecret, jwt)."
    );
  }

  const send = input as Partial<RingCentralSmsInput>;
  if (!send?.fromNumber || !send.toNumber || !send.text) {
    return providerError(providerId, requestId, "RingCentral SMS requires `fromNumber`, `toNumber`, and `text`.");
  }

  try {
    const result = await sendRingCentralSms(
      {
        fromNumber: send.fromNumber,
        toNumber: send.toNumber,
        text: send.text
      },
      credential,
      requestId
    );
    return { status: "ok", data: [result], meta: { providerId, requestId } };
  } catch (error) {
    return providerError(providerId, requestId, error instanceof Error ? error.message : "RingCentral SMS send failed.");
  }
}

export async function sendRingCentralSms(
  input: RingCentralSmsInput,
  credential: RingCentralSmsCredential,
  requestId?: string,
  fetchImpl: RingCentralFetch = fetch
): Promise<RingCentralSmsResult> {
  const serverUrl = normalizeServerUrl(credential.serverUrl);
  const accessToken = await requestRingCentralAccessToken(serverUrl, credential, fetchImpl);
  const response = await fetchImpl(`${serverUrl}/restapi/v1.0/account/~/extension/~/sms`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: { phoneNumber: input.fromNumber },
      to: [{ phoneNumber: input.toNumber }],
      text: input.text
    })
  });
  const json = await responseJson(response);

  if (!response.ok) {
    throw new Error(ringCentralErrorMessage(json, response.status, "RingCentral SMS send failed."));
  }

  return {
    providerMessageId: stringValue(json.id) || stringValue(json.messageId) || stringValue(json.uri) || requestId,
    status: "sent",
    recipient: input.toNumber,
    sentAt: new Date().toISOString()
  };
}

export async function requestRingCentralAccessToken(
  serverUrl: string,
  credential: RingCentralSmsCredential,
  fetchImpl: RingCentralFetch
) {
  const response = await fetchImpl(`${serverUrl}/restapi/oauth/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${credential.clientId}:${credential.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: jwtGrantType,
      assertion: credential.jwt
    })
  });
  const json = await responseJson(response);

  if (!response.ok) {
    throw new Error(ringCentralErrorMessage(json, response.status, "RingCentral auth failed."));
  }

  const accessToken = stringValue(json.access_token);
  if (!accessToken) {
    throw new Error("RingCentral auth did not return an access token.");
  }
  return accessToken;
}

function parseCredential(context: ProviderRequestContext): RingCentralSmsCredential | null {
  if (!context.credential?.secret) return ringCentralCredentialFromEnv();
  try {
    const parsed = JSON.parse(context.credential.secret) as Partial<RingCentralSmsCredential> &
      Record<string, string | undefined>;
    const credential = {
      clientId: parsed.clientId ?? parsed.RINGCENTRAL_CLIENT_ID ?? "",
      clientSecret: parsed.clientSecret ?? parsed.RINGCENTRAL_CLIENT_SECRET ?? "",
      jwt: parsed.jwt ?? parsed.RINGCENTRAL_JWT ?? "",
      serverUrl: parsed.serverUrl ?? parsed.RINGCENTRAL_SERVER_URL ?? defaultServerUrl
    };
    return credential.clientId && credential.clientSecret && credential.jwt ? credential : null;
  } catch {
    return null;
  }
}

export function normalizeServerUrl(value: string) {
  return (value || defaultServerUrl).replace(/\/+$/, "");
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

function ringCentralErrorMessage(json: Record<string, unknown>, status: number, fallback: string) {
  return stringValue(json.message) || stringValue(json.error_description) || stringValue(json.error) || `${fallback} HTTP ${status}.`;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}
