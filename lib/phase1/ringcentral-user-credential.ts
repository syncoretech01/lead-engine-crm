import { decryptSecretString } from "@/lib/phase1/secret-box";
import {
  ringCentralCredentialFromEnv,
  type RingCentralSmsCredential
} from "@/lib/providers/adapters/ringcentral-sms";
import type { User } from "@/lib/phase1/types";

const defaultServerUrl = "https://platform.ringcentral.com";

function tryDecrypt(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    return decryptSecretString(value);
  } catch {
    return undefined;
  }
}

/**
 * The encrypted `ringCentralJwt` field holds one of two shapes:
 *   - a plain JWT string — the SDR is on the shared Syncore RingCentral app
 *     (e.g. Sam), so the app's env client id/secret are used with their JWT;
 *   - JSON `{ jwt, clientId, clientSecret }` — the SDR is on their OWN
 *     RingCentral account, so their account's app credentials are used.
 * Packing the extra fields into the existing encrypted column avoids a schema
 * migration; both secrets stay encrypted at rest.
 */
function unpackStoredJwt(raw: string): { jwt: string; clientId?: string; clientSecret?: string } {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { jwt?: unknown; clientId?: unknown; clientSecret?: unknown };
      if (parsed && typeof parsed.jwt === "string") {
        return {
          jwt: parsed.jwt,
          clientId: typeof parsed.clientId === "string" ? parsed.clientId.trim() || undefined : undefined,
          clientSecret: typeof parsed.clientSecret === "string" ? parsed.clientSecret.trim() || undefined : undefined
        };
      }
    } catch {
      // fall through — treat the whole string as a plain JWT
    }
  }
  return { jwt: trimmed };
}

/**
 * Build the RingCentral credential to place a call / send an SMS AS this user.
 * - No stored JWT           → the shared company credential (legacy / server jobs).
 * - JWT on the shared app   → env client id/secret + the user's JWT (Sam).
 * - JWT + own app creds     → the user's OWN RingCentral account (Zack, Zainab).
 * Returns null when a stored JWT can't be decrypted, so callers block instead of
 * silently falling back to the wrong (shared) account.
 */
export function resolveUserRingCentralCredential(
  user: Pick<User, "ringCentralJwt">,
  env: NodeJS.ProcessEnv = process.env
): RingCentralSmsCredential | null {
  const envCredential = ringCentralCredentialFromEnv(env);

  const decrypted = tryDecrypt(user.ringCentralJwt);
  if (user.ringCentralJwt && !decrypted) {
    return null;
  }
  if (!decrypted) {
    return envCredential;
  }

  const { jwt, clientId, clientSecret } = unpackStoredJwt(decrypted);
  if (clientId && clientSecret) {
    return {
      clientId,
      clientSecret,
      jwt,
      serverUrl: env.RINGCENTRAL_SERVER_URL ?? envCredential?.serverUrl ?? defaultServerUrl
    };
  }

  return envCredential ? { ...envCredential, jwt } : null;
}
