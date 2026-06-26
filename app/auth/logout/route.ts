import type { NextRequest } from "next/server";
import { authRedirect } from "@/app/auth/route-response";
import { submitLogoutForm } from "@/lib/phase1/auth-flow";
import { authSessionCookieName } from "@/lib/phase1/auth-security";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const outcome = await submitLogoutForm(request.cookies.get(authSessionCookieName)?.value);
  return authRedirect(request, outcome);
}
