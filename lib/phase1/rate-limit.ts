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

export function clientIpFromHeaders(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }

  return headers.get("x-real-ip")?.trim() || "unknown";
}
