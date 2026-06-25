/**
 * Detect partial Unified Credits COSTS day rows (mid-sync / trailing day lag).
 */

import { localYmd } from "@/lib/f1-cursor-vendor";

/** Min daily USD on overlap days when deriving WA→portal uplift from unified COSTS. */
export const MIN_UNIFIED_COMPLETE_DAY_USD = 50;

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function enumerateDays(periodStart: Date, periodEnd: Date): Date[] {
  const startDay = startOfLocalDay(periodStart);
  const endDay = startOfLocalDay(periodEnd);
  if (startDay.getTime() > endDay.getTime()) return [];
  const out: Date[] = [];
  for (let d = new Date(startDay); d.getTime() <= endDay.getTime(); d.setDate(d.getDate() + 1)) {
    out.push(new Date(d));
  }
  return out;
}

/**
 * Unified COSTS can land mid-day with only a sliver synced. A tiny unified row must
 * not block lower-priority vendor layers when WA (or other feeds) are still catching up.
 */
export function isIncompleteUnifiedDaySync(unifiedUsd: number, waPoolUsd: number): boolean {
  if (unifiedUsd <= 0) return false;
  if (unifiedUsd < MIN_UNIFIED_COMPLETE_DAY_USD) return true;
  if (waPoolUsd < MIN_UNIFIED_COMPLETE_DAY_USD) return false;
  return unifiedUsd < waPoolUsd * 0.05;
}

export function incompleteUnifiedDayYmds(args: {
  periodStart: Date;
  periodEnd: Date;
  unifiedChatByYmd: Map<string, number>;
  unifiedCodByYmd: Map<string, number>;
  workspacePoolByYmd: Map<string, number>;
}): Set<string> {
  const skip = new Set<string>();
  for (const day of enumerateDays(args.periodStart, args.periodEnd)) {
    const ymd = localYmd(day);
    const unifiedUsd =
      (args.unifiedChatByYmd.get(ymd) ?? 0) + (args.unifiedCodByYmd.get(ymd) ?? 0);
    const waPoolUsd = args.workspacePoolByYmd.get(ymd) ?? 0;
    if (isIncompleteUnifiedDaySync(unifiedUsd, waPoolUsd)) skip.add(ymd);
  }
  return skip;
}

/** Median USD on days with complete unified COSTS coverage (for trailing-day projection). */
export function medianCompleteUnifiedDayUsd(args: {
  periodStart: Date;
  periodEnd: Date;
  unifiedChatByYmd: Map<string, number>;
  unifiedCodByYmd: Map<string, number>;
  workspacePoolByYmd: Map<string, number>;
  excludeYmd?: string;
}): number {
  const samples: number[] = [];
  for (const day of enumerateDays(args.periodStart, args.periodEnd)) {
    const ymd = localYmd(day);
    if (ymd === args.excludeYmd) continue;
    const unifiedUsd =
      (args.unifiedChatByYmd.get(ymd) ?? 0) + (args.unifiedCodByYmd.get(ymd) ?? 0);
    const waPoolUsd = args.workspacePoolByYmd.get(ymd) ?? 0;
    if (unifiedUsd >= MIN_UNIFIED_COMPLETE_DAY_USD && !isIncompleteUnifiedDaySync(unifiedUsd, waPoolUsd)) {
      samples.push(unifiedUsd);
    }
  }
  if (samples.length === 0) return 0;
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}
