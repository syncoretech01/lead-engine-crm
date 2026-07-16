import { describe, expect, it } from "vitest";

import {
  isPhoneSearchQuery,
  phoneMatchesSearch,
  phoneSearchDigits,
  textOrPhoneMatchesSearch
} from "@/lib/phone-search";

describe("phone search", () => {
  const stored = "+1 301 201 0899";

  it.each([
    "3012010899",
    "(301) 201-0899",
    "+1 (301) 201-0899",
    "301.201.0899",
    "201-0899"
  ])("matches the same phone when the query is %s", (query) => {
    expect(phoneMatchesSearch(stored, query)).toBe(true);
  });

  it("accepts an optional leading US country code on either side", () => {
    expect(phoneMatchesSearch("301-201-0899", "+1 301 201 0899")).toBe(true);
  });

  it("does not turn text containing digits into a phone query", () => {
    expect(isPhoneSearchQuery("Company 301")).toBe(false);
    expect(phoneMatchesSearch(stored, "Company 301")).toBe(false);
    expect(phoneMatchesSearch(stored, "301-201-9999")).toBe(false);
  });

  it("strips all display formatting", () => {
    expect(phoneSearchDigits("+1 (301) 201-0899")).toBe("13012010899");
  });

  it("lets the table filter match either ordinary text or a reformatted phone", () => {
    expect(textOrPhoneMatchesSearch("Oscar Gomez", stored, "oscar")).toBe(true);
    expect(textOrPhoneMatchesSearch("Oscar Gomez", stored, "(301) 201-0899")).toBe(true);
    expect(textOrPhoneMatchesSearch("Oscar Gomez", stored, "not present")).toBe(false);
  });
});
