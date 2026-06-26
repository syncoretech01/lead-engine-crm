import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authRedirect } from "@/app/auth/route-response";
import { submitLoginForm } from "@/lib/phase1/auth-flow";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const outcome = await submitLoginForm(await request.formData(), request.headers);
  return authRedirect(request, outcome);
}

export async function GET(request: NextRequest) {
  const redirectUrl = new URL("/login", request.url);
  const next = request.nextUrl.searchParams.get("next");
  if (next) {
    redirectUrl.searchParams.set("next", next);
  }
  return NextResponse.redirect(redirectUrl, 303);
}
