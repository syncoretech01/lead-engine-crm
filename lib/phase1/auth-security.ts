import {
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual
} from "node:crypto";

export const authSessionCookieName = "syncore_auth_session";
export const legacyDemoSessionCookieNames = {
  userId: "syncore_user_id",
  workspaceId: "syncore_workspace_id"
} as const;

export const defaultAuthSessionMaxAgeSeconds = 8 * 60 * 60;
const scryptKeyLength = 64;

export type SignedAuthSessionPayload = {
  sessionId: string;
  userId: string;
  workspaceId: string;
  expiresAt: string;
};

type AuthSecretEnv = {
  NEXT_PHASE?: string;
  NODE_ENV?: string;
  SYNCORE_AUTH_SECRET?: string;
  npm_lifecycle_event?: string;
};

export function hashPassword(password: string, salt = randomToken(16)) {
  const normalized = normalizePassword(password);
  const key = scryptSync(normalized, salt, scryptKeyLength).toString("base64url");
  return `scrypt$${salt}$${key}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [, salt, expectedKey] = storedHash.split("$");
  if (!salt || !expectedKey) {
    return false;
  }

  const actualKey = scryptSync(normalizePassword(password), salt, scryptKeyLength);
  const expected = Buffer.from(expectedKey, "base64url");
  return expected.length === actualKey.length && timingSafeEqual(expected, actualKey);
}

export function randomToken(byteLength = 32) {
  return randomBytes(byteLength).toString("base64url");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createSignedAuthSessionCookie(
  payload: SignedAuthSessionPayload,
  env: AuthSecretEnv = process.env as AuthSecretEnv
) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(encodedPayload, resolveAuthSecret(env));
  return `${encodedPayload}.${signature}`;
}

export function verifySignedAuthSessionCookie(
  value: string | undefined,
  env: AuthSecretEnv = process.env as AuthSecretEnv
): SignedAuthSessionPayload | undefined {
  if (!value) {
    return undefined;
  }

  const [encodedPayload, signature] = value.split(".");
  if (!encodedPayload || !signature) {
    return undefined;
  }

  const expected = sign(encodedPayload, resolveAuthSecret(env));
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as SignedAuthSessionPayload;
    if (!parsed.sessionId || !parsed.userId || !parsed.workspaceId || !parsed.expiresAt) {
      return undefined;
    }
    if (Date.parse(parsed.expiresAt) <= Date.now()) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function authCookieOptions(expiresAt: string) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt)
  };
}

export function expiredAuthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0)
  };
}

export function isProductionBuildPhase(env: AuthSecretEnv = process.env as AuthSecretEnv) {
  return env.NEXT_PHASE === "phase-production-build" || env.npm_lifecycle_event === "build";
}

function resolveAuthSecret(env: AuthSecretEnv) {
  const secret = env.SYNCORE_AUTH_SECRET?.trim();
  if (secret) {
    return secret;
  }

  if (env.NODE_ENV === "production" && !isProductionBuildPhase(env)) {
    throw new Error("SYNCORE_AUTH_SECRET is required in production.");
  }

  return "syncore-local-development-auth-secret";
}

function sign(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function normalizePassword(password: string) {
  return password.normalize("NFKC");
}
