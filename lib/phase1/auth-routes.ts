export const authSessionCookieName = "syncore_auth_session";

export function isPublicAuthPath(pathname: string) {
  return (
    pathname === "/login" ||
    pathname === "/reset-password" ||
    pathname.startsWith("/reset-password/") ||
    pathname.startsWith("/invite/")
  );
}

export function isPublicAssetPath(pathname: string) {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/icon") ||
    pathname.startsWith("/logos/") ||
    pathname.match(/\.(png|jpg|jpeg|gif|webp|svg|ico|css|js|map)$/i)
  );
}

export function isSignedWebhookPath(pathname: string) {
  return pathname === "/api/webhooks/email" || pathname === "/api/webhooks/sms";
}
