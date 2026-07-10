import { describe, expect, it } from "vitest";

import { estimateLeadJobCost } from "@/lib/phase1/lead-cost";

describe("estimateLeadJobCost", () => {
  it("treats a genuine 0-record request as 0, not 100", () => {
    const estimate = estimateLeadJobCost({ sources: ["Apollo"], requestedRecords: 0 });
    expect(estimate.requestedRecords).toBe(0);
  });

  it("falls back to 100 only when the requested count is not a finite number", () => {
    const estimate = estimateLeadJobCost({ sources: ["Apollo"], requestedRecords: Number.NaN });
    expect(estimate.requestedRecords).toBe(100);
  });

  it("clamps a negative requested count to 0", () => {
    const estimate = estimateLeadJobCost({ sources: ["Apollo"], requestedRecords: -25 });
    expect(estimate.requestedRecords).toBe(0);
  });

  it("preserves a normal requested count", () => {
    const estimate = estimateLeadJobCost({ sources: ["Apollo"], requestedRecords: 250 });
    expect(estimate.requestedRecords).toBe(250);
  });
});
