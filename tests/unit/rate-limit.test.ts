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

  it("reads the client IP from forwarded headers", () => {
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
  });
});
