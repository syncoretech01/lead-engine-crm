import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, clientIpFromHeaders, rateLimitingEnabled, resetRateLimits } from "@/lib/phase1/rate-limit";

describe("rate limiter", () => {
  beforeEach(() => resetRateLimits());

  it("allows requests up to the limit then blocks within the window", () => {
    const options = { limit: 3, windowMs: 60_000, now: 1_000 };
    expect(checkRateLimit("login:1.1.1.1", options).allowed).toBe(true);
    expect(checkRateLimit("login:1.1.1.1", options).allowed).toBe(true);
    expect(checkRateLimit("login:1.1.1.1", options).allowed).toBe(true);

    const blocked = checkRateLimit("login:1.1.1.1", options);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("isolates counts per key", () => {
    const options = { limit: 1, windowMs: 60_000, now: 5_000 };
    expect(checkRateLimit("login:1.1.1.1", options).allowed).toBe(true);
    expect(checkRateLimit("login:2.2.2.2", options).allowed).toBe(true);
    expect(checkRateLimit("login:1.1.1.1", options).allowed).toBe(false);
  });

  it("recovers after the window elapses", () => {
    expect(checkRateLimit("reset:1.1.1.1", { limit: 1, windowMs: 1_000, now: 0 }).allowed).toBe(true);
    expect(checkRateLimit("reset:1.1.1.1", { limit: 1, windowMs: 1_000, now: 500 }).allowed).toBe(false);
    expect(checkRateLimit("reset:1.1.1.1", { limit: 1, windowMs: 1_000, now: 1_500 }).allowed).toBe(true);
  });

  it("only enforces rate limiting in the production runtime", () => {
    expect(rateLimitingEnabled({ NODE_ENV: "production" })).toBe(true);
    expect(rateLimitingEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(rateLimitingEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(rateLimitingEnabled({ NODE_ENV: "production", npm_lifecycle_event: "build" })).toBe(false);
    expect(rateLimitingEnabled({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" })).toBe(false);
  });

  it("behind a trusted proxy, uses the proxy-appended (rightmost) IP and ignores spoofable earlier entries", () => {
    const env = { NODE_ENV: "production" }; // one trusted hop (Caddy) by default
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }), env)).toBe("10.0.0.1");
  });

  it("honors a configured trusted-proxy-hop count", () => {
    const env = { NODE_ENV: "production", SYNCORE_TRUSTED_PROXY_HOPS: "2" };
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "9.9.9.9, 203.0.113.7, 10.0.0.1" }), env)).toBe(
      "203.0.113.7"
    );
  });

  it("fails closed to 'unknown' when the forwarded chain is shorter than the trusted hop count", () => {
    const env = { NODE_ENV: "production", SYNCORE_TRUSTED_PROXY_HOPS: "2" };
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "10.0.0.1" }), env)).toBe("unknown");
  });

  it("never trusts X-Forwarded-For without a trusted proxy (dev/test), falling back to x-real-ip", () => {
    const env = { NODE_ENV: "test" };
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "203.0.113.7" }), env)).toBe("unknown");
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "198.51.100.4" }), env)).toBe("198.51.100.4");
    expect(clientIpFromHeaders(new Headers(), env)).toBe("unknown");
  });
});
