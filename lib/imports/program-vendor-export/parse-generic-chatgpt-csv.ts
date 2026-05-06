import Papa from "papaparse";

export type ParsedGenericCsv = {
  headers: string[];
  rows: Record<string, string>[];
  periodStart?: string;
  periodEnd?: string;
};

/** GPTs / projects exports share cadence + period columns with the users export. */
export function parseGenericChatgptAdminCsv(text: string): ParsedGenericCsv {
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
    throw new Error("CSV: no data rows");
  }
  const headers = parsed.meta.fields ?? Object.keys(rows[0] ?? {});
  const first = rows[0];
  const periodStart = first.period_start?.trim() || first.period_start;
  const periodEnd = first.period_end?.trim() || first.period_end;
  return {
    headers,
    rows,
    periodStart: periodStart || undefined,
    periodEnd: periodEnd || undefined,
  };
}
