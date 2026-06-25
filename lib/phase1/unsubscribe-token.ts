import { createHmac, timingSafeEqual } from "node:crypto";

type UnsubscribeEnv = Record<string, string | undefined>;

function secret(env: UnsubscribeEnv = process.env): string {
  return env.SYNCORE_UNSUBSCRIBE_SECRET?.trim() || "syncore-dev-unsubscribe-secret-change-me";
}

function b64url(value: Buffer | string): string {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  return buffer.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromB64url(value: string): Buffer {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(`${normalized}${padding}`, "base64");
}

function resolveAppBaseUrl(env: UnsubscribeEnv = process.env): string {
  return (env.SYNCORE_APP_URL || (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : "")).replace(/\/$/, "");
}

export function signUnsubscribeToken(workspaceId: string, contactId: string, env: UnsubscribeEnv = process.env): string {
  const payload = b64url(`${workspaceId}:${contactId}`);
  const sig = b64url(createHmac("sha256", secret(env)).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyUnsubscribeToken(
  token: string,
  env: UnsubscribeEnv = process.env
): { ok: true; workspaceId: string; contactId: string } | { ok: false } {
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) {
    return { ok: false };
  }

  const expected = b64url(createHmac("sha256", secret(env)).update(payload).digest());
  const providedBuffer = Buffer.from(sig);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
    return { ok: false };
  }

  try {
    const decoded = fromB64url(payload).toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator <= 0 || separator === decoded.length - 1) {
      return { ok: false };
    }
    return {
      ok: true,
      workspaceId: decoded.slice(0, separator),
      contactId: decoded.slice(separator + 1)
    };
  } catch {
    return { ok: false };
  }
}

export function buildUnsubscribeUrl(workspaceId: string, contactId: string, env: UnsubscribeEnv = process.env): string {
  const base = resolveAppBaseUrl(env);
  const token = signUnsubscribeToken(workspaceId, contactId, env);
  const path = `/unsubscribe/${encodeURIComponent(contactId)}?t=${encodeURIComponent(token)}`;
  return base ? `${base}${path}` : path;
}

export function buildOneClickUnsubscribeUrl(workspaceId: string, contactId: string, env: UnsubscribeEnv = process.env): string {
  const base = resolveAppBaseUrl(env);
  const token = signUnsubscribeToken(workspaceId, contactId, env);
  const path = `/api/unsubscribe?t=${encodeURIComponent(token)}`;
  return base ? `${base}${path}` : path;
}
