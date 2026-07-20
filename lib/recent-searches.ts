export const MAX_RECENT_SEARCHES = 5;

export function addRecentSearch(searches: string[], query: string): string[] {
  const normalized = query.trim().replace(/\s+/g, " ");
  if (!normalized) return searches.slice(0, MAX_RECENT_SEARCHES);

  return [
    normalized,
    ...searches.filter((search) => search.toLocaleLowerCase() !== normalized.toLocaleLowerCase())
  ].slice(0, MAX_RECENT_SEARCHES);
}

export function parseRecentSearches(value: string | null): string[] {
  if (!value) return [];

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    const searches: string[] = [];
    const seen = new Set<string>();
    for (const value of parsed) {
      if (typeof value !== "string") continue;
      const search = value.trim().replace(/\s+/g, " ");
      const key = search.toLocaleLowerCase();
      if (!search || seen.has(key)) continue;
      searches.push(search);
      seen.add(key);
      if (searches.length === MAX_RECENT_SEARCHES) break;
    }
    return searches;
  } catch {
    return [];
  }
}
