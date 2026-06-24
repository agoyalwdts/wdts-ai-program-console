import { deltaLookbackDays, type DeltaLookbackOptions } from "./delta-lookback";
import type { SyncTrigger } from "./types";

/** Inclusive local-calendar days from the 1st of the month through today. */
export function calendarDaysSinceMonthStart(now: Date = new Date()): number {
  return now.getDate();
}

/**
 * Vendor mirror pull depth: delta since last success, but never less than MTD
 * on page load / refresh / cron so F1 "this month" tiles match vendor totals.
 */
export function resolveVendorMirrorLookbackDays(
  lastSuccessAt: Date | null,
  trigger: SyncTrigger,
  deltaOpts: DeltaLookbackOptions,
  now: Date = new Date(),
): number {
  const cap = trigger === "cron" ? deltaOpts.maxOnCron : deltaOpts.maxOnRefresh;
  const delta = deltaLookbackDays(lastSuccessAt, trigger, deltaOpts);

  const mtdFloor =
    trigger === "page_load" || trigger === "manual_refresh" || trigger === "cron"
      ? calendarDaysSinceMonthStart(now)
      : 0;

  if (mtdFloor > 0) {
    return Math.min(Math.max(delta, mtdFloor), cap);
  }
  return Math.min(delta, cap);
}
