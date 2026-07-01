import { describe, expect, it } from "vitest";
import { isSameUtcDay, isUtcToday } from "@/lib/phase1/date-utils";

describe("UTC day helpers (P2.6)", () => {
  it("treats instants on the same UTC calendar day as equal", () => {
    expect(isSameUtcDay("2026-06-15T00:30:00.000Z", "2026-06-15T23:30:00.000Z")).toBe(true);
  });

  it("treats instants across a UTC midnight as different days", () => {
    // A server-local basis in a positive-offset timezone would count both of
    // these as the same local day — this asserts the UTC contract instead.
    expect(isSameUtcDay("2026-06-15T23:59:00.000Z", "2026-06-16T00:01:00.000Z")).toBe(false);
  });

  it("accepts Date and string inputs interchangeably", () => {
    expect(isSameUtcDay(new Date("2026-06-15T12:00:00.000Z"), "2026-06-15T01:00:00.000Z")).toBe(true);
  });

  it("isUtcToday compares against a provided 'now' in UTC", () => {
    const now = new Date("2026-06-15T12:00:00.000Z");
    expect(isUtcToday("2026-06-15T23:00:00.000Z", now)).toBe(true);
    expect(isUtcToday("2026-06-16T00:00:00.000Z", now)).toBe(false);
    expect(isUtcToday("2026-06-14T23:59:59.000Z", now)).toBe(false);
  });

  it("defaults 'now' to the current time", () => {
    expect(isUtcToday(new Date())).toBe(true);
  });
});
