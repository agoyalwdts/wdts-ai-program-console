"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { F1_PERIOD_OPTIONS, type F1Period } from "@/lib/f1-period";
import { cn } from "@/lib/utils";

export function HealthPeriodSelector({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = (searchParams.get("period") as F1Period | null) ?? "month";
  const value = current === "quarter" || current === "year" ? current : "month";

  return (
    <label className={cn("flex items-center gap-2 text-sm text-slate-700", className)}>
      <span className="whitespace-nowrap font-medium text-slate-600">Period</span>
      <select
        className={cn(
          "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900",
          "shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1",
        )}
        value={value}
        onChange={(e) => {
          const next = e.target.value as F1Period;
          const params = new URLSearchParams(searchParams.toString());
          if (next === "month") {
            params.delete("period");
          } else {
            params.set("period", next);
          }
          const q = params.toString();
          router.push(q ? `${pathname}?${q}` : pathname);
        }}
      >
        {F1_PERIOD_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
