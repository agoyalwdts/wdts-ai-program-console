import type { SyncTrigger } from "./types";

export type DeltaLookbackOptions = {
  min: number;
  maxOnRefresh: number;
  maxOnCron: number;
  initial: number;
};

/**
 * Days to pull when syncing vendor mirrors: since last success + 1 day buffer,
 * capped by trigger (page load vs cron).
 */
export function deltaLookbackDays(
  lastSuccessAt: Date | null,
  trigger: SyncTrigger,
  opts: DeltaLookbackOptions,
): number {
  const cap = trigger === "cron" ? opts.maxOnCron : opts.maxOnRefresh;
  if (!lastSuccessAt) return Math.min(opts.initial, cap);
  const elapsedMs = Date.now() - lastSuccessAt.getTime();
  const days = Math.ceil(elapsedMs / 86_400_000) + opts.min;
  return Math.min(Math.max(days, opts.min), cap);
}
