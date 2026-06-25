import { NextResponse, type NextRequest } from "next/server";
import { isPublicAssetPath, isPublicAuthPath, isPublicUnsubscribePath, isSignedWebhookPath } from "@/lib/phase1/auth-routes";

const authSessionCookieName = "syncore_auth_session";

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-syncore-pathname", pathname);

  if (isPublicAssetPath(pathname) || isPublicAuthPath(pathname) || isSignedWebhookPath(pathname) || isPublicUnsubscribePath(pathname)) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const hasAuthSession = Boolean(request.cookies.get(authSessionCookieName)?.value);
  if (!hasAuthSession) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
