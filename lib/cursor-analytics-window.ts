/**
 * Map Program Health (F1) calendar windows to Cursor Analytics query params.
 * Cursor accepts relative tokens (e.g. `30d`, `today`) and calendar dates.
 */

import type { F1PeriodPlan } from "@/lib/f1-period";
import { formatLocalYmd } from "@/lib/f1-period";

function calendarDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Inclusive local calendar bounds for Cursor `startDate` / `endDate`.
 * Uses `today` when the window ends on the current local day (matches Cursor docs).
 */
export function analyticsWindowForF1Plan(plan: F1PeriodPlan): {
  startDate: string;
  endDate: string;
} {
  const start = calendarDay(plan.periodStart);
  const end = calendarDay(plan.periodEnd);
  const today = calendarDay(new Date());
  const startDate = formatLocalYmd(start);
  const endYmd = formatLocalYmd(end);
  const endDate = endYmd === formatLocalYmd(today) ? "today" : endYmd;
  return { startDate, endDate };
}
