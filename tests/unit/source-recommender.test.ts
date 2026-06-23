import { describe, expect, it } from "vitest";
import { leadSourceOptions, recommendSourcesForIcp } from "@/lib/phase1/source-recommender";

describe("recommendSourcesForIcp", () => {
  it("leads with geography discovery for local-business ICPs", () => {
    const rec = recommendSourcesForIcp({ industries: ["Auto Repair"], titles: ["Owner"] });
    expect(rec.sources[0]).toBe("Google Places");
    expect(rec.sources).toContain("Apify");
  });

  it("recommends Apollo + Hunter for B2B / tech ICPs", () => {
    const rec = recommendSourcesForIcp({ industries: ["SaaS"], titles: ["VP Sales"] });
    expect(rec.sources).toEqual(["Apollo", "Hunter"]);
  });

  it("falls back to a general B2B mix", () => {
    const rec = recommendSourcesForIcp({ industries: ["Wholesale"], titles: ["Buyer"] });
    expect(rec.sources).toContain("Apollo");
    expect(rec.sources.length).toBeGreaterThanOrEqual(2);
  });

  it("only ever recommends real source options", () => {
    const rec = recommendSourcesForIcp({ industries: ["Dental"], titles: ["Office Manager"] });
    for (const source of rec.sources) {
      expect(leadSourceOptions).toContain(source);
    }
  });
});
