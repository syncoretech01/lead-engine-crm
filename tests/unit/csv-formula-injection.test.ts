import { describe, expect, it } from "vitest";
import { escapeCsvValue, toCsv } from "@/lib/phase1/csv";

describe("escapeCsvValue — formula/DDE injection", () => {
  it("prefixes a quote to cells that begin with a formula trigger", () => {
    expect(escapeCsvValue("=1+1")).toBe("'=1+1");
    expect(escapeCsvValue("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(escapeCsvValue("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
    expect(escapeCsvValue("+cmd")).toBe("'+cmd");
    expect(escapeCsvValue("-2+3+cmd|'/C calc'")).toBe("'-2+3+cmd|'/C calc'");
  });

  it("leaves legitimate numbers and phone numbers untouched", () => {
    expect(escapeCsvValue("-5")).toBe("-5");
    expect(escapeCsvValue("+3.14")).toBe("+3.14");
    expect(escapeCsvValue("+1 816 704 5551")).toBe("+1 816 704 5551");
    expect(escapeCsvValue("(816) 704-5551")).toBe("(816) 704-5551");
    expect(escapeCsvValue(42)).toBe("42");
  });

  it("still quote-wraps values with commas, quotes, or newlines", () => {
    expect(escapeCsvValue("Acme, Inc.")).toBe('"Acme, Inc."');
    expect(escapeCsvValue('a "quote"')).toBe('"a ""quote"""');
    // a formula value that also contains a comma is both prefixed and quoted
    expect(escapeCsvValue("=1,2")).toBe('"\'=1,2"');
  });

  it("neutralizes an injected cell end-to-end via toCsv", () => {
    const csv = toCsv([{ name: "=HYPERLINK(0)", note: "ok" }], ["name", "note"]);
    expect(csv).toBe("name,note\r\n'=HYPERLINK(0),ok");
  });
});
