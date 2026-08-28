import { describe, expect, it } from "vitest";

import { callDispositionValue, trackedCallStatusValue } from "@/lib/phase1/fast-read-utils";

/**
 * Call outcomes must degrade to the NEUTRAL member, never the most favourable one.
 *
 * The write path in app/actions.ts used to coerce a missing or unrecognised value
 * to "Connected"/"Interested", so a stale form or a hand-crafted request recorded
 * the best possible outcome — inflating the connect and interest rates managers
 * steer by, in the one place the data cannot be sanity-checked later. The read
 * path here already used the neutral members; both sides now agree, and these
 * assertions keep the contract from drifting back.
 */
describe("call outcome defaults are neutral", () => {
  it("falls back to Dialed, never Connected, for the call status", () => {
    expect(trackedCallStatusValue(undefined)).toBe("Dialed");
    expect(trackedCallStatusValue(null)).toBe("Dialed");
    expect(trackedCallStatusValue("")).toBe("Dialed");
    expect(trackedCallStatusValue("nonsense")).toBe("Dialed");
  });

  it("falls back to No answer, never Interested, for the disposition", () => {
    expect(callDispositionValue(undefined)).toBe("No answer");
    expect(callDispositionValue(null)).toBe("No answer");
    expect(callDispositionValue("")).toBe("No answer");
    expect(callDispositionValue("nonsense")).toBe("No answer");
  });

  it("still passes through every legitimate value", () => {
    expect(trackedCallStatusValue("Connected")).toBe("Connected");
    expect(trackedCallStatusValue("Voicemail")).toBe("Voicemail");
    expect(callDispositionValue("Interested")).toBe("Interested");
    expect(callDispositionValue("Meeting booked")).toBe("Meeting booked");
  });
});
