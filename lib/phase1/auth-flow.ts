import { defaultWorkspacePath } from "@/lib/phase1/auth";
import { acceptInvitePrismaFast, loginWithPasswordPrismaFast, revokeAuthSessionPrismaFast } from "@/lib/phase1/auth-fast-path";
import {
  acceptUserInvite,
  createPasswordResetToken,
  loginWithPassword,
  resetPasswordWithToken,
  revokeAuthSession
} from "@/lib/phase1/auth-service";
import { authWriteTables } from "@/lib/phase1/normalized-write-tables";
import { checkRateLimit, clientIpFromHeaders, rateLimitingEnabled } from "@/lib/phase1/rate-limit";
import { getSession, updateAuthState } from "@/lib/phase1/store";
import { passwordResetEmail, sendTransactionalEmail } from "@/lib/phase1/transactional-email-service";

type HeaderReader = {
  get(name: string): string | null;
};

export type AuthFormOutcome = {
  redirectTo: string;
  sessionCookie?: {
    value: string;
    expiresAt: string;
  };
  clearSessionCookie?: boolean;
};

export async function submitLoginForm(formData: FormData, headers: HeaderReader): Promise<AuthFormOutcome> {
  const email = stringValue(formData.get("email"));
  const password = stringValue(formData.get("password"));
  const next = safeNextPath(stringValue(formData.get("next")));

  const rate = enforceAuthRateLimit("login", headers, { limit: 10, windowMs: 5 * 60 * 1000 });
  if (!rate.allowed) {
    return { redirectTo: `/login?error=${encodeURIComponent(rateLimitMessage(rate))}&next=${encodeURIComponent(next)}` };
  }

  try {
    const result =
      await loginWithPasswordPrismaFast({ email, password }) ??
      await updateAuthState(
        (state) => loginWithPassword(state, { email, password }),
        { normalizedTables: authWriteTables }
      );

    return {
      redirectTo: next || defaultWorkspacePath(result.session),
      sessionCookie: {
        value: result.cookieValue,
        expiresAt: result.expiresAt
      }
    };
  } catch (error) {
    return { redirectTo: `/login?error=${encodeURIComponent(errorMessage(error))}&next=${encodeURIComponent(next)}` };
  }
}

export async function submitLogoutForm(cookieValue: string | undefined): Promise<AuthFormOutcome> {
  const fastRevoked = await revokeAuthSessionPrismaFast({ cookieValue });

  if (fastRevoked === undefined) {
    const session = await getSession();
    await updateAuthState((state) => {
      if (session.authSessionId) {
        revokeAuthSession(state, session.authSessionId);
      }
    }, { normalizedTables: authWriteTables });
  }

  return { redirectTo: "/login?loggedOut=1", clearSessionCookie: true };
}

export async function submitAcceptInviteForm(formData: FormData, headers: HeaderReader): Promise<AuthFormOutcome> {
  const token = stringValue(formData.get("token"));
  const name = stringValue(formData.get("name"));
  const password = stringValue(formData.get("password"));

  const rate = enforceAuthRateLimit("accept-invite", headers, { limit: 10, windowMs: 15 * 60 * 1000 });
  if (!rate.allowed) {
    return { redirectTo: `/invite/${encodeURIComponent(token)}?error=${encodeURIComponent(rateLimitMessage(rate))}` };
  }

  try {
    const result =
      await acceptInvitePrismaFast({ token, name, password }) ??
      await updateAuthState(
        (state) => acceptUserInvite(state, { token, name, password }),
        { normalizedTables: authWriteTables }
      );

    return {
      redirectTo: defaultWorkspacePath(result.session),
      sessionCookie: {
        value: result.cookieValue,
        expiresAt: result.expiresAt
      }
    };
  } catch (error) {
    return { redirectTo: `/invite/${encodeURIComponent(token)}?error=${encodeURIComponent(errorMessage(error))}` };
  }
}

export async function submitPasswordResetRequestForm(
  formData: FormData,
  headers: HeaderReader
): Promise<AuthFormOutcome> {
  const email = stringValue(formData.get("email"));

  const rate = enforceAuthRateLimit("reset-request", headers, { limit: 5, windowMs: 15 * 60 * 1000 });
  if (!rate.allowed) {
    return { redirectTo: `/reset-password?error=${encodeURIComponent(rateLimitMessage(rate))}` };
  }

  let resetUrl = "";
  await updateAuthState((state) => {
    resetUrl = createPasswordResetToken(state, email)?.url ?? "";
  }, { normalizedTables: authWriteTables });

  if (resetUrl) {
    try {
      await sendTransactionalEmail({ email: passwordResetEmail({ to: email, url: resetUrl }) });
    } catch {
      // Token creation succeeded; email delivery should not block the flow.
    }
  }

  const showLink = resetUrl && process.env.NODE_ENV !== "production";
  const query = showLink ? `?sent=1&reset=${encodeURIComponent(resetUrl)}` : "?sent=1";
  return { redirectTo: `/reset-password${query}` };
}

export async function submitPasswordResetForm(formData: FormData, headers: HeaderReader): Promise<AuthFormOutcome> {
  const token = stringValue(formData.get("token"));
  const password = stringValue(formData.get("password"));

  const rate = enforceAuthRateLimit("reset-confirm", headers, { limit: 10, windowMs: 15 * 60 * 1000 });
  if (!rate.allowed) {
    return { redirectTo: `/reset-password/${encodeURIComponent(token)}?error=${encodeURIComponent(rateLimitMessage(rate))}` };
  }

  try {
    await updateAuthState(
      (state) => resetPasswordWithToken(state, { token, password }),
      { normalizedTables: authWriteTables }
    );
  } catch (error) {
    return { redirectTo: `/reset-password/${encodeURIComponent(token)}?error=${encodeURIComponent(errorMessage(error))}` };
  }

  return { redirectTo: "/login?reset=1", clearSessionCookie: true };
}

export function stringValue(value: FormDataEntryValue | null, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

export function safeNextPath(value: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return value;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function enforceAuthRateLimit(scope: string, headers: HeaderReader, options: { limit: number; windowMs: number }) {
  if (!rateLimitingEnabled()) {
    return { allowed: true, remaining: options.limit, retryAfterMs: 0 };
  }

  return checkRateLimit(`${scope}:${clientIpFromHeaders(headers)}`, options);
}

function rateLimitMessage(result: { retryAfterMs: number }) {
  const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
  return `Too many attempts. Please try again in ${seconds}s.`;
}
