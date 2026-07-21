import { describe, expect, it } from "vitest";
import { userDateTimeToIso } from "@/lib/phase1/user-date-time";

describe("userDateTimeToIso", () => {
  it("interprets datetime-local values in the user's configured timezone", () => {
    expect(userDateTimeToIso("2026-07-20T09:00", "Asia/Karachi")).toBe(
      "2026-07-20T04:00:00.000Z"
    );
    expect(userDateTimeToIso("2026-07-20T09:00", "America/New_York")).toBe(
      "2026-07-20T13:00:00.000Z"
    );
    expect(userDateTimeToIso("2026-01-20T09:00", "America/New_York")).toBe(
      "2026-01-20T14:00:00.000Z"
    );
  });

  it("uses 9 AM for date-only values and UTC when no user timezone is set", () => {
    expect(userDateTimeToIso("2026-07-20", "Asia/Karachi")).toBe("2026-07-20T04:00:00.000Z");
    expect(userDateTimeToIso("2026-07-20T09:00")).toBe("2026-07-20T09:00:00.000Z");
  });

  it("preserves instants that already include an explicit offset", () => {
    expect(userDateTimeToIso("2026-07-20T04:00:00.000Z", "Asia/Karachi")).toBe(
      "2026-07-20T04:00:00.000Z"
    );
    expect(userDateTimeToIso("2026-07-20T09:00:00+05:00", "America/New_York")).toBe(
      "2026-07-20T04:00:00.000Z"
    );
  });

  it("rejects invalid dates, timezones, and nonexistent DST wall-clock times", () => {
    expect(() => userDateTimeToIso("2026-02-30T09:00", "UTC")).toThrow(/valid date/);
    expect(() => userDateTimeToIso("2026-07-20T09:00", "Not/A_Zone")).toThrow(/timezone is invalid/);
    expect(() => userDateTimeToIso("2026-03-08T02:30", "America/New_York")).toThrow(
      /does not exist/
    );
  });
});
