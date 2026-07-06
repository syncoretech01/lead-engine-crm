// Client-side CSV export from already-loaded rows — no server round-trip.

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  // Quote if the cell contains a comma, quote, or newline.
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export type CsvColumn<TRow> = {
  header: string;
  value: (row: TRow) => unknown;
};

export function exportRowsToCsv<TRow>(
  rows: TRow[],
  columns: CsvColumn<TRow>[],
  filename: string
) {
  const headerLine = columns.map((column) => csvCell(column.header)).join(",");
  const bodyLines = rows.map((row) => columns.map((column) => csvCell(column.value(row))).join(","));
  const csv = [headerLine, ...bodyLines].join("\r\n");

  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
