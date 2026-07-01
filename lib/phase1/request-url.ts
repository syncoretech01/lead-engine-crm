/**
 * Build an absolute URL for a redirect using the PUBLIC host.
 *
 * Behind a reverse proxy (Caddy/ALB) the app binds to 127.0.0.1:3000, so a
 * route handler's `request.url` is the internal address — redirecting off it
 * sends the browser to `localhost:3000`. The proxy sets `X-Forwarded-Host` /
 * `X-Forwarded-Proto` to the real public values, so prefer those; fall back to
 * `request.url` for direct/local access (dev). Pure (web `Request`/`URL` only)
 * so it needs no `next/server` and is unit-testable.
 */
export function resolvePublicUrl(request: Request, path: string): URL {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    return new URL(path, `${proto}://${forwardedHost}`);
  }
  return new URL(path, request.url);
}
