import { cache } from "react";

// Request-scoped cache for compact read models. This dedupes repeated server reads
// during one render without introducing cross-request staleness.
export function domainReadCache<Args extends unknown[], Result>(
  loader: (...args: Args) => Promise<Result>
) {
  return cache(loader);
}
