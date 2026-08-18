export type CsvValue = string | number | boolean | null | undefined;

const FORMULA_PREFIX = /^[\t\r\n ]*[=+\-@]/u;

export function csvCell(value: CsvValue): string {
  let raw = value === null || value === undefined ? "" : String(value);
  if (typeof value === "string" && FORMULA_PREFIX.test(raw)) {
    raw = `'${raw}`;
  }
  if (!/[",\n\r]/u.test(raw)) return raw;
  return `"${raw.replaceAll('"', '""')}"`;
}

export function csvDocument(rows: readonly (readonly CsvValue[])[]): string {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}
