import { describe, expect, it } from "vitest";

import {
  AUTH_FORM_MAX_BODY_BYTES,
  readBoundedFormData,
  readBoundedText,
  UNSUBSCRIBE_MAX_BODY_BYTES,
  WEBHOOK_MAX_BODY_BYTES
} from "@/lib/phase1/request-body-limit";

/**
 * The routes this protects run before ANY authentication — the proxy exempts
 * them and the signature is computed over the body, so the body has to be read
 * before anything can be checked. A Content-Length check alone is not a defence
 * there: omit the header, send chunked, and the whole body lands in the heap of
 * a box with ~1.4 GB of cgroup headroom.
 */
function streamingRequest(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
    cancel() {
      cancelled = true;
    }
  });
  const request = new Request("https://app.test/api/webhooks/email", {
    method: "POST",
    body: stream,
    headers,
    // Required by undici for a streaming body.
    duplex: "half"
  } as RequestInit & { duplex: "half" });
  return { request, wasCancelled: () => cancelled };
}

const bytes = (n: number, fill = 0x61) => new Uint8Array(n).fill(fill);

describe("bounded request body reads", () => {
  it("returns the body byte-for-byte when it fits", async () => {
    // Byte-exactness is the whole contract: this string is what the HMAC and the
    // SNS signature get checked against, so any re-encoding breaks verification.
    const payload = JSON.stringify({ type: "bounce", note: "üñïçødé ✓" });
    const { request } = streamingRequest([new TextEncoder().encode(payload)]);

    const result = await readBoundedText(request, WEBHOOK_MAX_BODY_BYTES);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe(payload);
  });

  it("rejects an oversized body declared in Content-Length before reading it", async () => {
    const { request, wasCancelled } = streamingRequest([bytes(16)], {
      "content-length": String(WEBHOOK_MAX_BODY_BYTES + 1)
    });

    const result = await readBoundedText(request, WEBHOOK_MAX_BODY_BYTES);

    expect(result).toMatchObject({ ok: false, status: 413 });
    // Rejected on the header alone — the stream was never opened.
    expect(wasCancelled()).toBe(false);
  });

  it("rejects a CHUNKED oversized body, which declares no length at all", async () => {
    // The case a Content-Length check cannot see, and the one that makes this a
    // remote OOM lever rather than a nuisance.
    const chunk = bytes(64 * 1024);
    const overCount = Math.ceil(WEBHOOK_MAX_BODY_BYTES / chunk.byteLength) + 4;
    const { request } = streamingRequest(Array.from({ length: overCount }, () => chunk));

    const result = await readBoundedText(request, WEBHOOK_MAX_BODY_BYTES);

    expect(result).toMatchObject({ ok: false, status: 413 });
  });

  it("stops reading instead of draining the whole body", async () => {
    const chunk = bytes(64 * 1024);
    const overCount = Math.ceil(WEBHOOK_MAX_BODY_BYTES / chunk.byteLength) + 200;
    const { request, wasCancelled } = streamingRequest(
      Array.from({ length: overCount }, () => chunk)
    );

    await readBoundedText(request, WEBHOOK_MAX_BODY_BYTES);

    // Cancelling is what turns "we refuse it" into "we never held it".
    expect(wasCancelled()).toBe(true);
  });

  it("accepts a body exactly at the bound and rejects one byte past it", async () => {
    const atLimit = streamingRequest([bytes(UNSUBSCRIBE_MAX_BODY_BYTES)]);
    const overLimit = streamingRequest([bytes(UNSUBSCRIBE_MAX_BODY_BYTES + 1)]);

    await expect(readBoundedText(atLimit.request, UNSUBSCRIBE_MAX_BODY_BYTES)).resolves.toMatchObject({
      ok: true
    });
    await expect(readBoundedText(overLimit.request, UNSUBSCRIBE_MAX_BODY_BYTES)).resolves.toMatchObject({
      ok: false,
      status: 413
    });
  });

  /**
   * readBoundedFormData is new code on four unauthenticated routes and had no
   * coverage at all — a no-op reimplementation left every other test here green.
   */
  describe("bounded formData", () => {
    function formRequest(body: string, contentType = "application/x-www-form-urlencoded") {
      return new Request("https://app.test/auth/login", {
        method: "POST",
        headers: { "content-type": contentType },
        body
      });
    }

    it("parses a normal urlencoded login body", async () => {
      const body = new URLSearchParams({
        email: "sam+sdr@syncoretech.com",
        password: "a b&c=d%20e",
        next: "/crm/contacts?owner=sam"
      }).toString();

      const result = await readBoundedFormData(formRequest(body), AUTH_FORM_MAX_BODY_BYTES);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Round-tripping through a string must not mangle the reserved characters
      // a real password contains.
      expect(result.formData.get("email")).toBe("sam+sdr@syncoretech.com");
      expect(result.formData.get("password")).toBe("a b&c=d%20e");
      expect(result.formData.get("next")).toBe("/crm/contacts?owner=sam");
    });

    it("preserves non-ASCII field values", async () => {
      const body = new URLSearchParams({ password: "pässwörd-✓-😀" }).toString();

      const result = await readBoundedFormData(formRequest(body), AUTH_FORM_MAX_BODY_BYTES);

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.formData.get("password")).toBe("pässwörd-✓-😀");
    });

    it("parses multipart text fields with the boundary intact", async () => {
      const boundary = "----syncoretest";
      const body =
        `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="email"\r\n\r\n' +
        "sam@syncoretech.com\r\n" +
        `--${boundary}--\r\n`;

      const result = await readBoundedFormData(
        formRequest(body, `multipart/form-data; boundary=${boundary}`),
        AUTH_FORM_MAX_BODY_BYTES
      );

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.formData.get("email")).toBe("sam@syncoretech.com");
    });

    it("refuses an oversized form body without parsing it", async () => {
      const body = new URLSearchParams({ password: "x".repeat(AUTH_FORM_MAX_BODY_BYTES) }).toString();

      const result = await readBoundedFormData(formRequest(body), AUTH_FORM_MAX_BODY_BYTES);

      expect(result).toMatchObject({ ok: false, status: 413 });
    });

    it("leaves room for a realistic login well under the bound", () => {
      const realistic = new URLSearchParams({
        email: "someone.with.a.long.address@syncoretech.com",
        password: "a".repeat(128),
        next: "/crm/contacts?owner=someone&view=all"
      }).toString();

      expect(new TextEncoder().encode(realistic).byteLength).toBeLessThan(AUTH_FORM_MAX_BODY_BYTES / 4);
    });
  });

  it("keeps the unsubscribe bound far tighter than the webhook bound", () => {
    // A List-Unsubscribe POST is a few bytes; there is no reason for it to carry
    // the same allowance as a batch of SES events.
    expect(UNSUBSCRIBE_MAX_BODY_BYTES).toBeLessThan(WEBHOOK_MAX_BODY_BYTES);
  });
});
