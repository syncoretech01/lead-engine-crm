/**
 * Byte-bounded body reads for the routes that run BEFORE any authentication.
 *
 * `/api/import/csv` can check Content-Length and then buffer, because by that
 * point it has already resolved a session and a permission — a chunked request
 * that lies about its length costs an authenticated caller's memory. The signed
 * webhooks and the unsubscribe endpoint have no such luxury: the proxy exempts
 * them (auth-routes.ts), and the signature is computed OVER the body, so the
 * body must be read before anything can be verified. A Content-Length check
 * alone is not a defence there — omit the header, send chunked, and the whole
 * body lands in the heap of a box with ~1.4GB of cgroup headroom.
 *
 * So this streams and stops. Nothing beyond `maxBytes` is ever retained, and the
 * source is cancelled rather than drained, so an attacker gets backpressure
 * instead of a place to put a few hundred megabytes.
 *
 * Byte-exact by construction: the chunks are concatenated and decoded once, so
 * callers still get precisely the string `request.text()` would have produced —
 * which matters, because these strings are what the HMAC and the SNS signature
 * are checked against.
 */

/** Our own signed webhooks carry a handful of events; SNS caps a message at 256KB. */
export const WEBHOOK_MAX_BODY_BYTES = 1024 * 1024;

/** A List-Unsubscribe POST is a few bytes. This is already absurdly generous. */
export const UNSUBSCRIBE_MAX_BODY_BYTES = 64 * 1024;

/**
 * The pre-auth auth forms: an email, a password, a token, a next path.
 *
 * These are the routes the rate limiter cannot protect — it lives inside
 * submitLoginForm, which cannot run until request.formData() has already put the
 * whole body in the heap.
 */
export const AUTH_FORM_MAX_BODY_BYTES = 16 * 1024;

/** Small JSON bodies on cookie-gated API routes. */
export const JSON_API_MAX_BODY_BYTES = 64 * 1024;

export type BoundedBodyResult =
  | { ok: true; text: string }
  | { ok: false; status: 413; error: string };

export async function readBoundedText(request: Request, maxBytes: number): Promise<BoundedBodyResult> {
  const tooLarge = {
    ok: false as const,
    status: 413 as const,
    error: `Request body is too large (${Math.floor(maxBytes / 1024)}KB max).`
  };

  // Cheap rejection for an honest client, before a single byte is read.
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return tooLarge;
  }

  const body = request.body;
  if (!body) {
    // No stream to bound (an empty body). request.text() returns "" here.
    return { ok: true, text: await request.text() };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        // Drop what we hold and stop the producer. Returning without cancelling
        // would leave the connection draining into a buffer nobody reads.
        chunks.length = 0;
        await reader.cancel().catch(() => {});
        return tooLarge;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { ok: true, text: new TextDecoder().decode(joined) };
}

export type BoundedFormResult =
  | { ok: true; formData: FormData }
  | { ok: false; status: 413; error: string };

/**
 * A byte-bounded `request.formData()`.
 *
 * Reads under the cap first, then re-parses the buffered body through a throwaway
 * Request so the platform's own multipart/urlencoded parsing still applies —
 * hand-rolling URLSearchParams here would silently mis-handle multipart.
 *
 * The round trip goes through a string, which would corrupt binary file parts.
 * That is fine for every caller: the pre-auth auth forms accept no uploads, and
 * a client that sends one gets fields that fail validation rather than anything
 * dangerous. File uploads belong on a route that authenticates first.
 */
export async function readBoundedFormData(request: Request, maxBytes: number): Promise<BoundedFormResult> {
  const bounded = await readBoundedText(request, maxBytes);
  if (!bounded.ok) {
    return bounded;
  }
  const contentType = request.headers.get("content-type") ?? "application/x-www-form-urlencoded";
  const replayed = new Request(request.url, {
    method: "POST",
    headers: { "content-type": contentType },
    body: bounded.text
  });
  return { ok: true, formData: await replayed.formData() };
}
