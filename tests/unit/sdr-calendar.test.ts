import { describe, expect, it } from "vitest";

import {
  buildSdrCalendarDays,
  dateKeyInTimeZone,
  isSdrScheduledFollowUp,
  resolveSdrCalendarMonth
} from "@/lib/phase1/sdr-calendar";

describe("SDR calendar", () => {
  it("excludes system first-touch reminders from follow-up surfaces", () => {
    expect(isSdrScheduledFollowUp({ title: "First touch Kimberly" })).toBe(false);
    expect(isSdrScheduledFollowUp({ title: "first-touch Michael" })).toBe(false);
    expect(isSdrScheduledFollowUp({ title: "Follow up with Kimberly" })).toBe(true);
    expect(isSdrScheduledFollowUp({ title: "Next step with Michael" })).toBe(true);
  });

  it("resolves month navigation and a stable six-week grid", () => {
    const month = resolveSdrCalendarMonth("2026-07");
    const days = buildSdrCalendarDays(month);

    expect(month).toMatchObject({ key: "2026-07", previousKey: "2026-06", nextKey: "2026-08" });
    expect(days).toHaveLength(42);
    expect(days[0]).toMatchObject({ key: "2026-06-28", inMonth: false });
    expect(days[3]).toMatchObject({ key: "2026-07-01", dayNumber: 1, inMonth: true });
  });

  it("places reminders on the SDR's local calendar date", () => {
    expect(dateKeyInTimeZone("2026-07-16T01:30:00.000Z", "America/New_York")).toBe("2026-07-15");
    expect(dateKeyInTimeZone("2026-07-16T01:30:00.000Z", "UTC")).toBe("2026-07-16");
  });
});
