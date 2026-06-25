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

/** Median USD on days with at least MIN unified (baseline for trailing-day detection). */
export function medianUnifiedDayUsdLoose(args: {
  periodStart: Date;
  periodEnd: Date;
  unifiedChatByYmd: Map<string, number>;
  unifiedCodByYmd: Map<string, number>;
  excludeYmd?: string;
}): number {
  const samples: number[] = [];
  for (const day of enumerateDays(args.periodStart, args.periodEnd)) {
    const ymd = localYmd(day);
    if (ymd === args.excludeYmd) continue;
    const unifiedUsd =
      (args.unifiedChatByYmd.get(ymd) ?? 0) + (args.unifiedCodByYmd.get(ymd) ?? 0);
    if (unifiedUsd >= MIN_UNIFIED_COMPLETE_DAY_USD) samples.push(unifiedUsd);
  }
  if (samples.length === 0) return 0;
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}

/** Unified row is far below the typical complete day (mid-sync or partial day). */
export function isUnderMedianUnifiedDay(unifiedUsd: number, medianCompleteDayUsd: number): boolean {
  if (unifiedUsd <= 0) return false;
  if (medianCompleteDayUsd < MIN_UNIFIED_COMPLETE_DAY_USD) return false;
  return unifiedUsd < medianCompleteDayUsd * 0.75;
}

/**
 * Unified COSTS can land mid-day with only a sliver synced. A tiny unified row must
 * not block lower-priority vendor layers when WA (or other feeds) are still catching up.
 */
export function isIncompleteUnifiedDaySync(
  unifiedUsd: number,
  waPoolUsd: number,
  medianCompleteDayUsd = 0,
): boolean {
  if (unifiedUsd <= 0) return false;
  if (unifiedUsd < MIN_UNIFIED_COMPLETE_DAY_USD) return true;
  if (isUnderMedianUnifiedDay(unifiedUsd, medianCompleteDayUsd)) return true;
  if (waPoolUsd < MIN_UNIFIED_COMPLETE_DAY_USD) return false;
  return unifiedUsd < waPoolUsd * 0.05;
}

export function shouldSkipUnifiedDay(args: {
  unifiedUsd: number;
  waPoolUsd: number;
  medianCompleteDayUsd: number;
}): boolean {
  if (args.unifiedUsd <= 0) return false;
  return isIncompleteUnifiedDaySync(
    args.unifiedUsd,
    args.waPoolUsd,
    args.medianCompleteDayUsd,
  );
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
    const medianExcludingDay = medianUnifiedDayUsdLoose({
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      unifiedChatByYmd: args.unifiedChatByYmd,
      unifiedCodByYmd: args.unifiedCodByYmd,
      excludeYmd: ymd,
    });
    if (
      shouldSkipUnifiedDay({
        unifiedUsd,
        waPoolUsd,
        medianCompleteDayUsd: medianExcludingDay,
      })
    ) {
      skip.add(ymd);
    }
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
  const medianLoose = medianUnifiedDayUsdLoose({
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    unifiedChatByYmd: args.unifiedChatByYmd,
    unifiedCodByYmd: args.unifiedCodByYmd,
    excludeYmd: args.excludeYmd,
  });
  if (medianLoose <= 0) return 0;

  const samples: number[] = [];
  for (const day of enumerateDays(args.periodStart, args.periodEnd)) {
    const ymd = localYmd(day);
    if (ymd === args.excludeYmd) continue;
    const unifiedUsd =
      (args.unifiedChatByYmd.get(ymd) ?? 0) + (args.unifiedCodByYmd.get(ymd) ?? 0);
    const waPoolUsd = args.workspacePoolByYmd.get(ymd) ?? 0;
    if (
      unifiedUsd >= MIN_UNIFIED_COMPLETE_DAY_USD &&
      !isIncompleteUnifiedDaySync(unifiedUsd, waPoolUsd, medianLoose)
    ) {
      samples.push(unifiedUsd);
    }
  }
  if (samples.length === 0) return medianLoose;
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}
