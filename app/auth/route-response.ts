import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { AuthFormOutcome } from "@/lib/phase1/auth-flow";
import {
  authCookieOptions,
  authSessionCookieName,
  expiredAuthCookieOptions
} from "@/lib/phase1/auth-security";

export function authRedirect(request: NextRequest, outcome: AuthFormOutcome) {
  const response = NextResponse.redirect(new URL(outcome.redirectTo, request.url), 303);

  if (outcome.sessionCookie) {
    response.cookies.set(
      authSessionCookieName,
      outcome.sessionCookie.value,
      authCookieOptions(outcome.sessionCookie.expiresAt)
    );
  }

  if (outcome.clearSessionCookie) {
    response.cookies.set(authSessionCookieName, "", expiredAuthCookieOptions());
  }

  return response;
}
