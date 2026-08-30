import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authRedirect, resolvePublicUrl } from "@/app/auth/route-response";
import { submitLoginForm } from "@/lib/phase1/auth-flow";
import { AUTH_FORM_MAX_BODY_BYTES, readBoundedFormData } from "@/lib/phase1/request-body-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  // Bounded BEFORE parsing: these routes are proxy-exempt (auth-routes.ts) and
  // the rate limiter lives inside the submit helper, so it cannot fire until the
  // whole body is already in the heap.
  const bounded = await readBoundedFormData(request, AUTH_FORM_MAX_BODY_BYTES);
  if (!bounded.ok) {
    return NextResponse.json({ error: bounded.error }, { status: bounded.status });
  }
  const outcome = await submitLoginForm(bounded.formData, request.headers);
  return authRedirect(request, outcome);
}

export async function GET(request: NextRequest) {
  const redirectUrl = resolvePublicUrl(request, "/login");
  const next = request.nextUrl.searchParams.get("next");
  if (next) {
    redirectUrl.searchParams.set("next", next);
  }
  return NextResponse.redirect(redirectUrl, 303);
}
