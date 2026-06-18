import type { F1Period, F1PeriodPlan } from "@/lib/f1-period";

/** Period banner for F1 / Analytics — single calendar (or custom) window for all products. */
export function F1PeriodRangeLine({
  plan,
  className = "text-sm text-slate-600",
}: {
  plan: F1PeriodPlan;
  period?: F1Period;
  className?: string;
}) {
  return <p className={className}>{plan.rangeDescription}</p>;
}
