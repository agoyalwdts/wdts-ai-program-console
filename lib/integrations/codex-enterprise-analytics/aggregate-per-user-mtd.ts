import type { CodexUsageRow } from "./types";

export function normCodexAnalyticsEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function resolveCodexUsageRowEmail(row: CodexUsageRow): string | null {
  const raw = row.email?.trim();
  if (raw && raw.includes("@")) return raw;
  return null;
}

/** Sum credits in [monthStartSec, endSec) per normalized email. */
export function aggregateMtdCreditsByNormEmail(args: {
  rows: CodexUsageRow[];
  monthStartSec: number;
  endSec: number;
}): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of args.rows) {
    if (r.start_time < args.monthStartSec || r.start_time >= args.endSec) continue;
    const email = resolveCodexUsageRowEmail(r);
    if (!email) continue;
    const credits =
      typeof r.totals?.credits === "number" && Number.isFinite(r.totals.credits)
        ? r.totals.credits
        : 0;
    if (credits <= 0) continue;
    const key = normCodexAnalyticsEmail(email);
    out.set(key, (out.get(key) ?? 0) + credits);
  }
  return out;
}

/** Latest bucket end_time (seconds) with credits &gt; 0 per email, for idle / dormancy. */
export function aggregateLastActivityEndSecByNormEmail(
  rows: CodexUsageRow[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const email = resolveCodexUsageRowEmail(r);
    if (!email) continue;
    const credits =
      typeof r.totals?.credits === "number" && Number.isFinite(r.totals.credits)
        ? r.totals.credits
        : 0;
    if (credits <= 0) continue;
    const end =
      typeof r.end_time === "number" && Number.isFinite(r.end_time) ? r.end_time : r.start_time;
    const key = normCodexAnalyticsEmail(email);
    const prev = out.get(key);
    if (prev == null || end > prev) out.set(key, end);
  }
  return out;
}
