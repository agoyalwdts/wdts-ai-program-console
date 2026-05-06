import type { F1PeriodPlan } from "@/lib/f1-period";
import { formatLocalYmd } from "@/lib/f1-period";

function calendarDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

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
