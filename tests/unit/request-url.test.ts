import { describe, expect, it } from "vitest";
import { resolvePublicUrl } from "@/lib/phase1/request-url";

describe("resolvePublicUrl (reverse-proxy redirect host)", () => {
  it("uses X-Forwarded-Host + proto when present (behind Caddy/ALB)", () => {
    const request = new Request("http://127.0.0.1:3000/auth/login", {
      headers: { "x-forwarded-host": "app.syncoretech.com", "x-forwarded-proto": "https" }
    });
    expect(resolvePublicUrl(request, "/sdr/queue").toString()).toBe("https://app.syncoretech.com/sdr/queue");
  });

  it("defaults proto to https when only the forwarded host is set", () => {
    const request = new Request("http://127.0.0.1:3000/auth/login", {
      headers: { "x-forwarded-host": "app.syncoretech.com" }
    });
    expect(resolvePublicUrl(request, "/").toString()).toBe("https://app.syncoretech.com/");
  });

  it("falls back to request.url when there is no proxy (dev/direct)", () => {
    const request = new Request("http://localhost:3000/auth/login");
    expect(resolvePublicUrl(request, "/sdr/queue").toString()).toBe("http://localhost:3000/sdr/queue");
  });

  it("preserves query params added to the returned URL", () => {
    const request = new Request("http://127.0.0.1:3000/auth/login", {
      headers: { "x-forwarded-host": "app.syncoretech.com", "x-forwarded-proto": "https" }
    });
    const url = resolvePublicUrl(request, "/login");
    url.searchParams.set("next", "/crm");
    expect(url.toString()).toBe("https://app.syncoretech.com/login?next=%2Fcrm");
  });
});
