type RateLimitOptions = {
  limit: number;
  windowMs: number;
  now?: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
};

type RateLimitEnv = {
  NODE_ENV?: string;
  NEXT_PHASE?: string;
  npm_lifecycle_event?: string;
  SYNCORE_TRUSTED_PROXY_HOPS?: string;
};

const hitsByKey = new Map<string, number[]>();

/**
 * In-memory sliding-window rate limiter. Sufficient for a single app instance
 * (the internal deployment target). When the app scales to multiple instances,
 * replace the backing store with a shared Redis-backed limiter (see ROADMAP
 * M1/M4).
 */
export function checkRateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const now = options.now ?? Date.now();
  const windowStart = now - options.windowMs;
  const recent = (hitsByKey.get(key) ?? []).filter((timestamp) => timestamp > windowStart);

  if (recent.length >= options.limit) {
    hitsByKey.set(key, recent);
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, recent[0] + options.windowMs - now) };
  }

  recent.push(now);
  hitsByKey.set(key, recent);
  return { allowed: true, remaining: Math.max(0, options.limit - recent.length), retryAfterMs: 0 };
}

export function resetRateLimits() {
  hitsByKey.clear();
}

/**
 * Rate limiting is a production hardening control; it is disabled in local and
 * test runtimes so development and the e2e suite are not throttled.
 */
export function rateLimitingEnabled(env: RateLimitEnv = process.env as RateLimitEnv) {
  if (env.NODE_ENV !== "production") {
    return false;
  }

  return env.NEXT_PHASE !== "phase-production-build" && env.npm_lifecycle_event !== "build";
}

/**
 * Number of trusted reverse-proxy hops in front of the app. In the AWS deployment
 * that is exactly one (Caddy on the instance); locally there is none. Overridable
 * via SYNCORE_TRUSTED_PROXY_HOPS if the topology changes (e.g. an ALB or CDN is
 * placed in front of Caddy).
 */
export function trustedProxyHops(env: RateLimitEnv = process.env as RateLimitEnv): number {
  const raw = env.SYNCORE_TRUSTED_PROXY_HOPS;
  if (raw !== undefined) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return env.NODE_ENV === "production" ? 1 : 0;
}

/**
 * Resolve the client IP used for rate-limit bucketing. `X-Forwarded-For` is only
 * trusted for the hops our own proxies append: with N trusted hops the client is
 * the Nth entry from the right, and everything to its left is client-controllable
 * and must be ignored. Trusting the leftmost entry (the previous behaviour) let an
 * attacker mint a fresh bucket per request by spoofing the header, defeating the
 * login / reset / invite and webhook throttles.
 */
export function clientIpFromHeaders(
  headers: { get(name: string): string | null },
  env: RateLimitEnv = process.env as RateLimitEnv
): string {
  const hops = trustedProxyHops(env);

  if (hops > 0) {
    const forwarded = headers.get("x-forwarded-for");
    if (forwarded) {
      const parts = forwarded
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      const index = parts.length - hops;
      const ip = index >= 0 ? parts[index] : undefined;
      if (ip) {
        return ip;
      }
    }

    // Behind a trusted proxy the client IP must come from the proxy-appended
    // X-Forwarded-For. A missing or too-short chain means the request did not
    // traverse the expected hops — fail closed to a shared bucket rather than
    // trust a client-settable header.
    return "unknown";
  }

  // No trusted proxy (local/dev/test): X-Forwarded-For is fully client-controlled,
  // so it is never trusted here. Rate limiting is disabled outside production
  // anyway (see rateLimitingEnabled).
  return headers.get("x-real-ip")?.trim() || "unknown";
}
