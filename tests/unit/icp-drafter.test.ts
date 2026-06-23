import { describe, expect, it, vi } from "vitest";
import { resolveIcpDraft } from "@/lib/llm/icp-drafter";
import { validateIcpDraft, type IcpDraft } from "@/lib/llm/icp-schema";

const sampleDraft: IcpDraft = {
  name: "TX Auto Repair Owners",
  description: "Owners of independent auto repair shops in Texas.",
  industries: ["Automotive", "Auto Repair"],
  titles: ["Owner", "General Manager"],
  geographies: ["Texas, US"],
  technologies: [],
  segments: ["High-review shops"],
  fitSignals: ["Has a website"],
  confidence: 82
};

describe("validateIcpDraft", () => {
  it("sanitizes a well-formed payload (trim, de-dupe, clamp)", () => {
    const result = validateIcpDraft({
      name: "  Dealer Owners  ",
      description: "Car dealership owners.",
      industries: ["Automotive", "Automotive", " Dealerships "],
      titles: ["Owner"],
      geographies: ["Texas"],
      technologies: ["Shopify"],
      segments: ["High volume"],
      fitSignals: ["Has DMS"],
      confidence: 140
    });

    expect(result).not.toBeNull();
    expect(result?.name).toBe("Dealer Owners");
    expect(result?.industries).toEqual(["Automotive", "Dealerships"]);
    expect(result?.confidence).toBe(95);
  });

  it("fills sensible defaults for empty optional lists", () => {
    const result = validateIcpDraft({ name: "X", titles: ["Owner"] });

    expect(result?.geographies).toEqual(["United States"]);
    expect(result?.segments.length).toBeGreaterThan(0);
    expect(result?.fitSignals.length).toBeGreaterThan(0);
  });

  it("rejects payloads without a name or any targeting signal", () => {
    expect(validateIcpDraft({ industries: ["Automotive"] })).toBeNull();
    expect(validateIcpDraft({ name: "X" })).toBeNull();
    expect(validateIcpDraft("not an object")).toBeNull();
    expect(validateIcpDraft(null)).toBeNull();
  });
});

describe("resolveIcpDraft", () => {
  it("falls back to the deterministic parser when the LLM is disabled", async () => {
    // SYNCORE_ENABLE_LLM is unset in the test env, so no network call is made.
    const fallback = vi.fn(() => sampleDraft);
    const result = await resolveIcpDraft("auto repair owners in texas", fallback);

    expect(fallback).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("fallback");
    expect(result.draft).toEqual(sampleDraft);
  });
});
