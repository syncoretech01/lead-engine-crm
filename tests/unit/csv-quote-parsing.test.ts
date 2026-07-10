import { describe, expect, it } from "vitest";

import { parseCsv } from "@/lib/phase1/csv";

describe("parseCsv quote handling", () => {
  it("treats a stray quote in an unquoted field as a literal and keeps columns aligned", () => {
    const rows = parseCsv('name,street\n6" Sub Shop,123 Main St');
    expect(rows).toEqual([{ name: '6" Sub Shop', street: "123 Main St" }]);
  });

  it("does not let a stray quote swallow the delimiter and the rest of the row", () => {
    const rows = parseCsv('a,b,c\n1,2" wide,3');
    expect(rows).toEqual([{ a: "1", b: '2" wide', c: "3" }]);
  });

  it("still parses properly quoted fields with embedded commas and escaped quotes", () => {
    const rows = parseCsv('name,note\n"Acme, Inc.","Says ""hi"" often"');
    expect(rows).toEqual([{ name: "Acme, Inc.", note: 'Says "hi" often' }]);
  });

  it("still parses a quoted field that contains newlines", () => {
    const rows = parseCsv('name,note\n"Acme","line one\nline two"');
    expect(rows).toEqual([{ name: "Acme", note: "line one\nline two" }]);
  });
});
