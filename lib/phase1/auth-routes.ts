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

/**
 * Chat-machine endpoints authenticate themselves with the fail-closed M2M
 * bearer in lib/growth/chat-auth.ts. They must reach that route without a human
 * browser-session cookie; the exact allow-list keeps every other API protected
 * by the global session proxy.
 */
export function isChatMachineApiPath(pathname: string) {
  return (
    pathname === "/api/chat/niche-request" ||
    /^\/api\/approvals\/[^/]+\/(decide|revise)$/.test(pathname)
  );
}

export function isPublicUnsubscribePath(pathname: string) {
  return pathname === "/api/unsubscribe" || pathname.startsWith("/unsubscribe/");
}

export function isPublicHealthPath(pathname: string) {
  return pathname === "/api/health";
}
