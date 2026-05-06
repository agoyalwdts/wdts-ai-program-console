export type ParsedCodexSessionsJson = {
  /** credit_total summed by date */
  creditsByDate: Record<string, number>;
  /** Distinct users seen */
  userCount: number;
  /** Total rows in export */
  rowCount: number;
};

export function parseCodexSessionsJson(text: string): ParsedCodexSessionsJson {
  const raw = JSON.parse(text) as { data?: unknown };
  if (!Array.isArray(raw.data)) {
    throw new Error("Codex sessions JSON: expected { data: array }");
  }
  const creditsByDate: Record<string, number> = {};
  const emails = new Set<string>();
  let rowCount = 0;

  for (const row of raw.data) {
    if (!row || typeof row !== "object") continue;
    rowCount++;
    const o = row as Record<string, unknown>;
    const date = typeof o.date === "string" ? o.date : "";
    const credit =
      typeof o.credit_total === "number" ? o.credit_total : Number(o.credit_total);
    if (!date || Number.isNaN(credit)) continue;
    creditsByDate[date] = (creditsByDate[date] ?? 0) + credit;
    const email = typeof o.email === "string" ? o.email.trim() : "";
    if (email) emails.add(email);
  }

  const dates = Object.keys(creditsByDate);
  if (dates.length === 0) {
    throw new Error("Codex sessions JSON: no credit_total by date");
  }

  return { creditsByDate, userCount: emails.size, rowCount };
}
