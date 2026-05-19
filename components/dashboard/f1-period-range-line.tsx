import type { F1Period, F1PeriodPlan } from "@/lib/f1-period";

/**
 * Period banner for F1 / Analytics — shows split windows when ChatGPT/Codex
 * use the 16th billing anchor but other products use calendar month.
 */
export function F1PeriodRangeLine({
  plan,
  period,
  className = "text-sm text-slate-600",
}: {
  plan: F1PeriodPlan;
  period: F1Period;
  className?: string;
}) {
  if (period === "month" && plan.openAiRangeDescription) {
    return (
      <p className={className}>
        <span className="font-medium text-slate-800">ChatGPT & Codex:</span>{" "}
        {plan.openAiRangeDescription}
        <span className="text-slate-400 mx-1.5" aria-hidden>
          ·
        </span>
        <span className="font-medium text-slate-800">Other products:</span>{" "}
        {plan.rangeDescription}
      </p>
    );
  }

  return <p className={className}>{plan.rangeDescription}</p>;
}
