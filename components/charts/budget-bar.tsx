import { cn } from "@/lib/utils";

export function BudgetBar({
  spend,
  budget,
  warnAt = 0.8,
}: {
  spend: number;
  budget: number;
  warnAt?: number;
}) {
  const pct = budget > 0 ? Math.min(spend / budget, 1.25) : 0;
  const widthPct = Math.min(pct * 100, 100);
  const overBudget = pct >= 1;
  const warning = pct >= warnAt && !overBudget;
  return (
    <div className="space-y-1.5">
      <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            overBudget ? "bg-rose-500" : warning ? "bg-amber-500" : "bg-emerald-500",
          )}
          style={{ width: `${widthPct}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>{(pct * 100).toFixed(1)}% MTD</span>
        <span>
          remaining {Math.max(budget - spend, 0).toLocaleString("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 0,
          })}
        </span>
      </div>
    </div>
  );
}
