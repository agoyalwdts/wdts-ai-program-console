import Papa from "papaparse";

export type ParsedCursorTeamCsv = {
  /** First column is treated as ISO date when it matches YYYY-MM-DD */
  headers: string[];
  rows: Record<string, string>[];
  dateColumn: string;
};

export function parseCursorTeamCsv(text: string): ParsedCursorTeamCsv {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors[0]?.message ?? "CSV parse error");
  }
  const rows = parsed.data.filter((r) => Object.keys(r).length > 0);
  if (rows.length === 0) {
    throw new Error("Cursor team CSV: no rows");
  }
  const headers = parsed.meta.fields ?? Object.keys(rows[0] ?? {});
  const dateColumn = headers.find((h) => /^date$/i.test(h)) ?? headers[0] ?? "Date";
  return { headers, rows, dateColumn };
}
