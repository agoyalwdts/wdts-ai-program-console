/**
 * Workspace-level Codex usage rows → daily USD keyed by local YMD (F1 chart + VendorDailySpend sync).
 */

import type { CodexUsageRow } from "./types";

/** UTC calendar date from API bucket start (matches sync job). */
export function utcYmdFromUnixSec(sec: number): string {
  const d = new Date(sec * 1000);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

/** Civil calendar date from API UTC YMD at local noon — matches VendorDailySpend / F1 semantics. */
export function localNoonFromApiUtcYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function localYmdFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Sum credits per API UTC day, convert to USD, roll up to local YMD keys. */
export function aggregateWorkspaceUsageSpendByLocalYmd(
  rows: CodexUsageRow[],
  usdPerCredit: number,
): Map<string, number> {
  const byUtcYmd = new Map<string, number>();
  for (const r of rows) {
    const ymd = utcYmdFromUnixSec(r.start_time);
    const credits =
      typeof r.totals?.credits === "number" && Number.isFinite(r.totals.credits) ? r.totals.credits : 0;
    if (credits <= 0) continue;
    byUtcYmd.set(ymd, (byUtcYmd.get(ymd) ?? 0) + credits);
  }

  const out = new Map<string, number>();
  for (const [ymd, credits] of byUtcYmd) {
    const localKey = localYmdFromDate(localNoonFromApiUtcYmd(ymd));
    const usd = credits * usdPerCredit;
    out.set(localKey, (out.get(localKey) ?? 0) + usd);
  }
  return out;
}
