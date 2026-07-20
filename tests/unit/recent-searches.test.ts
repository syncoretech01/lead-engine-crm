import { describe, expect, it } from "vitest";

import { addRecentSearch, parseRecentSearches } from "@/lib/recent-searches";

describe("recent search history", () => {
  it("keeps the five newest searches", () => {
    const history = ["one", "two", "three", "four", "five", "six"].reduce(
      (searches, query) => addRecentSearch(searches, query),
      [] as string[]
    );

    expect(history).toEqual(["six", "five", "four", "three", "two"]);
  });

  it("moves a duplicate search to the front without changing its spelling", () => {
    expect(addRecentSearch(["Maya", "Acme", "Sam"], "  acme  ")).toEqual([
      "acme",
      "Maya",
      "Sam"
    ]);
  });

  it("safely parses stored history and rejects malformed storage", () => {
    expect(parseRecentSearches('["Maya", "Acme", "Sam"]')).toEqual(["Maya", "Acme", "Sam"]);
    expect(parseRecentSearches("not-json")).toEqual([]);
    expect(parseRecentSearches('{"query":"Maya"}')).toEqual([]);
  });
});
