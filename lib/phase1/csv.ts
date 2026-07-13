export function parseCsv(input: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
      continue;
    }

    if (char === '"' && (inQuotes || field === "")) {
      // A quote is only structural at a field boundary: it opens a quoted field
      // when the field is still empty, and closes one while we are inside it. A
      // stray quote mid-field (e.g. `6" Sub Shop`) is a literal character — without
      // this guard it flipped `inQuotes`, swallowed the next delimiter, and silently
      // misaligned every downstream column.
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }

      row.push(field);
      if (row.some((value) => value.trim().length > 0)) {
        rows.push(row);
      }
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((value) => value.trim().length > 0)) {
    rows.push(row);
  }

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((header) => header.trim());

  return rows.slice(1).map((values) => {
    return headers.reduce<Record<string, string>>((record, header, index) => {
      record[header] = (values[index] ?? "").trim();
      return record;
    }, {});
  });
}

export function toCsv(rows: Record<string, string | number | boolean | undefined>[], columns: string[]) {
  const header = columns.map(escapeCsvValue).join(",");
  const body = rows.map((row) => columns.map((column) => escapeCsvValue(row[column] ?? "")).join(","));
  return [header, ...body].join("\r\n");
}

export function escapeCsvValue(value: string | number | boolean) {
  let stringValue = String(value);

  // Neutralize CSV/DDE formula injection: a cell beginning with = + - @ (or a leading
  // tab/CR that spreadsheets strip before parsing) is executed as a formula when the
  // file is opened in Excel/Sheets — a downloaded lead export could exfiltrate data or
  // run a command. Prefix a single quote to force text. Leave plainly numeric / phone-
  // like values (which legitimately start with + or -) untouched so numbers and phone
  // numbers still render. See OWASP "CSV Injection".
  if (/^[=+\-@\t\r]/.test(stringValue) && !/^[+-]?[\d\s().,-]+$/.test(stringValue)) {
    stringValue = `'${stringValue}`;
  }

  if (/[",\r\n]/.test(stringValue)) {
    return `"${stringValue.replaceAll('"', '""')}"`;
  }

  return stringValue;
}

export function splitList(value: FormDataEntryValue | null) {
  if (!value || typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
