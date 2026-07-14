import { describe, expect, it } from "vitest";

import { parseBrokerNotes } from "@/lib/phase1/broker-notes";

const NOTES = [
  "MC# MC-260504 | USDOT 4517595",
  "Active authority date: 02/19/2026",
  "Authority status: Active",
  "Authority type: PROPERTY BROKER",
  "Authority action: GRANTED",
  "Bond filed: Yes (required: Yes)",
  "Address: 725 OPPORTUNITY DR, SAINT CLOUD, MN, 56301-5886"
].join("\n");

describe("parseBrokerNotes", () => {
  it("returns null for non-broker notes", () => {
    expect(parseBrokerNotes("Called, left a voicemail.")).toBeNull();
    expect(parseBrokerNotes("")).toBeNull();
  });

  it("parses the import's broker blob into structured Key Account Fields", () => {
    const parsed = parseBrokerNotes(NOTES);
    expect(parsed).not.toBeNull();
    const byLabel = Object.fromEntries((parsed?.fields ?? []).map((f) => [f.label, f.value]));
    expect(byLabel["MC number"]).toBe("MC-260504");
    expect(byLabel["USDOT"]).toBe("4517595");
    expect(byLabel["Authority"]).toBe("Active · PROPERTY BROKER");
    expect(byLabel["Bond filed"]).toBe("Yes (required: Yes)");
    expect(byLabel["Address"]).toBe("Saint Cloud, MN 56301-5886");
  });

  it("derives the state (for local time) and a clean fit reason", () => {
    const parsed = parseBrokerNotes(NOTES);
    expect(parsed?.state).toBe("MN");
    expect(parsed?.fitReason).toContain("Property Broker");
    expect(parsed?.fitReason).toContain("active authority");
    expect(parsed?.fitReason).toContain("bond filed");
    // never dumps the raw blob
    expect(parsed?.fitReason).not.toContain("USDOT");
  });
});
