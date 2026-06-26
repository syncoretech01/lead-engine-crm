import type { NextRequest } from "next/server";
import { authRedirect } from "@/app/auth/route-response";
import { submitLoginForm } from "@/lib/phase1/auth-flow";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const outcome = await submitLoginForm(await request.formData(), request.headers);
  return authRedirect(request, outcome);
}
