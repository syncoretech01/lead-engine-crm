import { inflateRawSync } from "node:zlib";

/**
 * Minimal .xlsx reader — enough to import a flat sheet, no dependency added.
 *
 * The XML parsing is deliberately split out from the unzipping so the part that
 * actually gets things wrong is unit-testable without a binary fixture (and
 * without committing a spreadsheet full of real contact details to the repo).
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

/** Unzips the entries an xlsx needs. Handles stored and deflated members. */
function unzip(buffer: Buffer): Map<string, Buffer> {
  // Walk the central directory rather than scanning for local headers: local
  // headers may defer their sizes to a trailing data descriptor, the central
  // directory never does.
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a valid .xlsx file: no zip end-of-central-directory record.");

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let pointer = buffer.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(pointer) !== CENTRAL_SIGNATURE) break;
    const method = buffer.readUInt16LE(pointer + 10);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.toString("utf8", pointer + 46, pointer + 46 + nameLength);

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(start, start + compressedSize);
    files.set(name, method === 0 ? raw : inflateRawSync(raw));

    pointer += 46 + nameLength + extraLength + commentLength;
  }

  return files;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // Ampersand last, so "&amp;lt;" does not turn into "<".
    .replace(/&amp;/g, "&");
}

/** `<si>` entries, each possibly split across several `<t>` runs. */
export function parseSharedStrings(sharedStringsXml: string): string[] {
  const strings: string[] = [];
  for (const entry of sharedStringsXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let text = "";
    for (const run of entry[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) text += run[1];
    strings.push(decodeXmlText(text));
  }
  return strings;
}

/**
 * A worksheet's cells as `{ [columnLetter]: value }` per row, in sheet order.
 *
 * The regex MUST tolerate self-closing empty cells (`<c r="B2" s="6"/>`). A
 * pattern that only matches `<c ...>...</c>` runs straight past the empty cell
 * and swallows the NEXT cell's contents, which silently shifts every column
 * after any blank — one blank DBA cell moved emails into the comments column and
 * made a 246-row sheet read as "no email addresses at all".
 */
export function parseSheetCells(sheetXml: string, sharedStrings: string[]): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [];
  const cellPattern = /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

  for (const rowMatch of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: Record<string, string> = {};
    for (const cell of rowMatch[1].matchAll(cellPattern)) {
      const [, column, attributes, body = ""] = cell;
      let value = "";
      if (/t="inlineStr"/.test(attributes)) {
        for (const run of body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) value += decodeXmlText(run[1]);
      } else {
        const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
        value = /t="s"/.test(attributes) ? sharedStrings[Number(raw)] ?? "" : decodeXmlText(raw);
      }
      cells[column] = value.trim();
    }
    rows.push(cells);
  }

  return rows;
}

/**
 * Reads the first worksheet as objects keyed by its header row. Columns with a
 * blank header, and rows where every mapped cell is empty, are dropped — a
 * trailing block of formatted-but-empty rows is normal in a hand-edited sheet.
 */
export function readXlsxRows(buffer: Buffer): Array<Record<string, string>> {
  const files = unzip(buffer);
  const sheetName = [...files.keys()].find((name) => /^xl\/worksheets\/sheet1\.xml$/.test(name));
  if (!sheetName) throw new Error("Workbook has no xl/worksheets/sheet1.xml.");

  const sharedStrings = parseSharedStrings(files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "");
  const rows = parseSheetCells(files.get(sheetName)!.toString("utf8"), sharedStrings);
  if (rows.length === 0) return [];

  const header = rows[0];
  const columns = Object.entries(header).filter(([, label]) => label !== "");

  return rows
    .slice(1)
    .map((cells) => {
      const record: Record<string, string> = {};
      for (const [column, label] of columns) record[label] = cells[column] ?? "";
      return record;
    })
    .filter((record) => Object.values(record).some((value) => value !== ""));
}

/**
 * Excel stores dates as days since 1899-12-30 in the 1900 system. Returns an
 * ISO date, or "" when the value is not a usable serial (already a date string,
 * blank, or out of a sane range).
 */
export function excelSerialToIsoDate(value: string): string {
  const serial = Number(value);
  if (!value || !Number.isFinite(serial) || !/^\d+(\.\d+)?$/.test(value.trim())) return "";
  // Guard against a stray small integer being read as 1900-01-xx.
  if (serial < 20_000 || serial > 80_000) return "";
  return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
}
