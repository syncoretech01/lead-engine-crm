import { describe, expect, it } from "vitest";

import { excelSerialToIsoDate, parseSharedStrings, parseSheetCells } from "@/lib/phase1/xlsx";

const SHARED = `<?xml version="1.0"?><sst count="6" uniqueCount="6">
  <si><t>Company Name</t></si>
  <si><t>DBA</t></si>
  <si><t>Contact Email</t></si>
  <si><t>HIPPOMIND LLC</t></si>
  <si><t>hrk2@hotmail.com</t></si>
  <si><t>Smith &amp; Sons</t></si>
</sst>`;

describe("xlsx reader", () => {
  it("joins multi-run shared strings and decodes entities", () => {
    const strings = parseSharedStrings(
      `<sst><si><r><t>Smith </t></r><r><t>&amp; Sons</t></r></si><si><t>A &lt;B&gt;</t></si></sst>`
    );
    expect(strings).toEqual(["Smith & Sons", "A <B>"]);
  });

  // The bug this file exists for. A self-closing empty cell is normal in a
  // hand-edited sheet; a pattern that only matches <c ...>...</c> runs past it
  // and eats the NEXT cell, shifting every later column by one. Read that way,
  // a sheet where all 246 rows have an email reports zero emails.
  it("keeps columns aligned across a self-closing empty cell", () => {
    const sheet = `<worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
      <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" s="6"/><c r="C2" t="s"><v>4</v></c></row>
    </sheetData></worksheet>`;

    const rows = parseSheetCells(sheet, parseSharedStrings(SHARED));

    expect(rows[0]).toEqual({ A: "Company Name", B: "DBA", C: "Contact Email" });
    // B stays empty and C keeps its OWN value rather than inheriting nothing.
    expect(rows[1]).toEqual({ A: "HIPPOMIND LLC", B: "", C: "hrk2@hotmail.com" });
  });

  it("reads inline strings and bare numeric cells", () => {
    const sheet = `<worksheet><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>Zip</t></is></c><c r="B1"><v>24210</v></c></row>
    </sheetData></worksheet>`;

    expect(parseSheetCells(sheet, [])[0]).toEqual({ A: "Zip", B: "24210" });
  });

  it("converts Excel date serials and refuses anything that is not one", () => {
    expect(excelSerialToIsoDate("46174")).toBe("2026-06-01");
    expect(excelSerialToIsoDate("46027")).toBe("2026-01-05");
    expect(excelSerialToIsoDate("")).toBe("");
    expect(excelSerialToIsoDate("2026-06-01")).toBe("");
    expect(excelSerialToIsoDate("7")).toBe("");
    expect(excelSerialToIsoDate("Landscaping")).toBe("");
  });
});
