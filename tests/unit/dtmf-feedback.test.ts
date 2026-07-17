import { describe, expect, it } from "vitest";

import { appendDtmfDigit, dtmfToneFrequencies, isDtmfKey } from "@/lib/dtmf-feedback";

describe("DTMF keypad feedback", () => {
  it("maps keypad keys to their standard dual-tone frequencies", () => {
    expect(dtmfToneFrequencies("1")).toEqual([697, 1209]);
    expect(dtmfToneFrequencies("5")).toEqual([770, 1336]);
    expect(dtmfToneFrequencies("#")).toEqual([941, 1477]);
  });

  it("rejects non-DTMF keys", () => {
    expect(isDtmfKey("9")).toBe(true);
    expect(isDtmfKey("A")).toBe(false);
    expect(dtmfToneFrequencies("A")).toBeUndefined();
  });

  it("keeps a bounded running display of pressed digits", () => {
    expect(appendDtmfDigit("12", "#")).toBe("12#");
    expect(appendDtmfDigit("1234", "5", 4)).toBe("2345");
    expect(appendDtmfDigit("12", "x")).toBe("12");
  });
});
