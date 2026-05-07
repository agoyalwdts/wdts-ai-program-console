export type ParsedCodexSessionsJson = {
  /** credit_total summed by date */
  creditsByDate: Record<string, number>;
  /** credit_total summed per user email (lowercased) — for F1 leaderboard merge */
  users: { email: string; credits_used: number }[];
  /** Distinct users with any credited row */
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
  const creditsByEmail = new Map<string, number>();
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
    const emailRaw = typeof o.email === "string" ? o.email.trim() : "";
    if (emailRaw) {
      const key = emailRaw.toLowerCase();
      creditsByEmail.set(key, (creditsByEmail.get(key) ?? 0) + credit);
    }
  }

  const dates = Object.keys(creditsByDate);
  if (dates.length === 0) {
    throw new Error("Codex sessions JSON: no credit_total by date");
  }

  const users = [...creditsByEmail.entries()].map(([email, credits_used]) => ({
    email,
    credits_used,
  }));

  return {
    creditsByDate,
    users,
    userCount: creditsByEmail.size,
    rowCount,
  };
}
