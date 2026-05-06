import { cn } from "@/lib/utils";

export function BudgetBar({
  spend,
  budget,
  warnAt = 0.8,
  unit = "usd",
}: {
  spend: number;
  budget: number;
  warnAt?: number;
  unit?: "usd" | "credits";
}) {
  const ratio = budget > 0 ? spend / budget : 0;
  const widthPct = Math.min(ratio * 100, 100);
  const overBudget = ratio >= 1;
  const warning = ratio >= warnAt && !overBudget;
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
        <span>{(ratio * 100).toFixed(1)}% MTD</span>
        <span>
          remaining{" "}
          {unit === "credits"
            ? `${Math.max(budget - spend, 0).toLocaleString("en-US", {
                maximumFractionDigits: 0,
              })} credits`
            : Math.max(budget - spend, 0).toLocaleString("en-US", {
                style: "currency",
                currency: "USD",
                maximumFractionDigits: 0,
              })}
        </span>
      </div>
    </div>
  );
}
