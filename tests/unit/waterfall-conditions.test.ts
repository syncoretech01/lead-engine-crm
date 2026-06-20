import { describe, expect, it } from "vitest";
import { evaluateCondition, resolveField, type WaterfallLeadState } from "@/lib/phase1/waterfall-conditions";

const base: WaterfallLeadState = {
  email: "owner@acme.com",
  emailValidationStatus: "valid",
  phone: undefined,
  linkedinUrl: "https://linkedin.com/in/owner",
  domain: "acme.com",
  country: "US",
  leadScore: 82,
  contactsFound: 1,
  engagement: ["opened", "clicked"]
};

describe("evaluateCondition", () => {
  it("returns true for an absent condition (always run)", () => {
    expect(evaluateCondition(undefined, base)).toBe(true);
  });

  it("exists / isMissing", () => {
    expect(evaluateCondition({ field: "email", op: "exists" }, base)).toBe(true);
    expect(evaluateCondition({ field: "phone", op: "isMissing" }, base)).toBe(true);
    expect(evaluateCondition({ field: "phone", op: "exists" }, base)).toBe(false);
    // empty string and empty array read as missing
    expect(evaluateCondition({ field: "email", op: "exists" }, { ...base, email: "" })).toBe(false);
    expect(evaluateCondition({ field: "engagement", op: "exists" }, { ...base, engagement: [] })).toBe(false);
  });

  it("equals / notEquals (missing field never equals)", () => {
    expect(evaluateCondition({ field: "country", op: "equals", value: "US" }, base)).toBe(true);
    expect(evaluateCondition({ field: "country", op: "equals", value: "EU" }, base)).toBe(false);
    expect(evaluateCondition({ field: "phone", op: "equals", value: "x" }, base)).toBe(false);
    expect(evaluateCondition({ field: "phone", op: "notEquals", value: "x" }, base)).toBe(true);
  });

  it("in / notIn including array-field membership (engagement)", () => {
    expect(evaluateCondition({ field: "email.validationStatus", op: "in", value: ["valid", "catch_all"] }, base)).toBe(true);
    expect(evaluateCondition({ field: "email.validationStatus", op: "notIn", value: ["risky", "invalid"] }, base)).toBe(true);
    // engagement is an array → membership is intersection
    expect(evaluateCondition({ field: "engagement", op: "in", value: ["replied", "clicked"] }, base)).toBe(true);
    expect(evaluateCondition({ field: "engagement", op: "in", value: ["replied", "booked"] }, base)).toBe(false);
  });

  it("gte / lte (numeric only)", () => {
    expect(evaluateCondition({ field: "leadScore", op: "gte", value: 80 }, base)).toBe(true);
    expect(evaluateCondition({ field: "leadScore", op: "gte", value: 90 }, base)).toBe(false);
    expect(evaluateCondition({ field: "leadScore", op: "lte", value: 100 }, base)).toBe(true);
    // non-numeric resolves false
    expect(evaluateCondition({ field: "email", op: "gte", value: 1 }, base)).toBe(false);
  });

  it("all / any / not composition", () => {
    const phoneMissingAndEngaged = {
      all: [
        { field: "phone", op: "isMissing" as const },
        { any: [{ field: "engagement", op: "in" as const, value: ["opened"] }, { field: "leadScore", op: "gte" as const, value: 70 }] }
      ]
    };
    expect(evaluateCondition(phoneMissingAndEngaged, base)).toBe(true);
    expect(evaluateCondition({ not: { field: "country", op: "equals", value: "US" } }, base)).toBe(false);
  });

  it("company.* fields alias the lead's email/phone", () => {
    expect(resolveField(base, "company.email")).toBe("owner@acme.com");
    expect(resolveField({ ...base, phoneValidationStatus: "valid" }, "company.phone.validationStatus")).toBe("valid");
  });

  it("unknown fields resolve to undefined (read as missing)", () => {
    expect(resolveField(base, "totally.unknown")).toBeUndefined();
    expect(evaluateCondition({ field: "totally.unknown", op: "isMissing" }, base)).toBe(true);
  });
});
