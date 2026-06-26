export function isPublicAuthPath(pathname: string) {
  return (
    pathname === "/login" ||
    pathname === "/auth/login" ||
    pathname === "/auth/logout" ||
    pathname === "/auth/accept-invite" ||
    pathname === "/auth/request-password-reset" ||
    pathname === "/auth/reset-password" ||
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
  return (
    pathname === "/api/webhooks/email" ||
    pathname === "/api/webhooks/sms" ||
    pathname === "/api/webhooks/ses"
  );
}

export function isPublicUnsubscribePath(pathname: string) {
  return pathname === "/api/unsubscribe" || pathname.startsWith("/unsubscribe/");
}
