/**
 * Single fail-closed policy for required secrets.
 *
 * Every secret used in a production request path must resolve through
 * `requireSecret` so it cannot silently fall back to a guessable default in
 * production. Extracted so the auth, credential-vault, webhook, and unsubscribe
 * secrets share one implementation instead of copy-pasted guards (the drift
 * that left the unsubscribe secret unguarded — see P0.1/P0.3).
 */

export type SecretEnv = Record<string, string | undefined>;

/**
 * True during a Next.js production build (`next build`), where `NODE_ENV` is
 * "production" but runtime secrets are not yet injected. Secret resolution must
 * not throw in this phase or the build would fail.
 */
export function isProductionBuildPhase(env: SecretEnv = process.env): boolean {
  return env.NEXT_PHASE === "phase-production-build" || env.npm_lifecycle_event === "build";
}

/**
 * Resolve a required secret:
 * - return the configured value when present (trimmed);
 * - throw at production runtime when it is missing — never sign/encrypt with a
 *   guessable default in prod;
 * - allow a labeled development default outside production and during the
 *   production build phase.
 */
export function requireSecret(name: string, devDefault: string, env: SecretEnv = process.env): string {
  const value = env[name]?.trim();
  if (value) {
    return value;
  }

  if (env.NODE_ENV === "production" && !isProductionBuildPhase(env)) {
    throw new Error(`${name} is required in production.`);
  }

  return devDefault;
}
