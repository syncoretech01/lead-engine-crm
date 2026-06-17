import { NextResponse, type NextRequest } from "next/server";
import {
  authSessionCookieName,
  isPublicAssetPath,
  isPublicAuthPath
} from "@/lib/phase1/auth-routes";

/**
 * Defense-in-depth auth backstop. Page-level guards (getSession /
 * getWorkspaceContext) remain authoritative; this middleware only redirects
 * obviously-unauthenticated page requests to /login so that a newly added
 * route cannot accidentally skip the gate. API routes authenticate themselves
 * and return JSON errors, so they are not redirected here. The demo-session
 * escape hatch (local/dev only) is honored so it does not force a login.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/api/") ||
    isPublicAssetPath(pathname) ||
    isPublicAuthPath(pathname) ||
    process.env.SYNCORE_ALLOW_DEMO_SESSION === "true"
  ) {
    return NextResponse.next();
  }

  if (!request.cookies.get(authSessionCookieName)?.value) {
    const loginUrl = new URL("/login", request.url);
    if (pathname && pathname !== "/") {
      loginUrl.searchParams.set("next", pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
