"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { F1_PERIOD_OPTIONS, formatLocalYmd, type F1Period } from "@/lib/f1-period";
import { HealthCustomRangeCalendar } from "@/components/dashboard/health-custom-range-calendar";
import { cn } from "@/lib/utils";

function startOfCurrentMonth(): string {
  const d = new Date();
  return formatLocalYmd(new Date(d.getFullYear(), d.getMonth(), 1));
}

function todayYmd(): string {
  return formatLocalYmd(new Date());
}

export function HealthPeriodSelector({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlPeriod = (searchParams.get("period") as F1Period | null) ?? "month";
  const value: F1Period =
    urlPeriod === "quarter" || urlPeriod === "year" || urlPeriod === "custom"
      ? urlPeriod
      : "month";

  const fromUrl = searchParams.get("from") ?? "";
  const toUrl = searchParams.get("to") ?? "";

  const pushParams = (next: URLSearchParams) => {
    const q = next.toString();
    router.push(q ? `${pathname}?${q}` : pathname);
  };

  return (
    <div className={cn("flex flex-wrap items-end gap-3", className)}>
      <label className="flex flex-col gap-1 text-sm text-slate-700">
        <span className="font-medium text-slate-600">Period</span>
        <select
          className={cn(
            "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 min-w-[10rem]",
            "shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1",
          )}
          value={value}
          onChange={(e) => {
            const next = e.target.value as F1Period;
            const params = new URLSearchParams(searchParams.toString());
            if (next === "month") {
              params.delete("period");
              params.delete("from");
              params.delete("to");
            } else if (next === "custom") {
              params.set("period", "custom");
              const f = fromUrl || startOfCurrentMonth();
              const t = toUrl || todayYmd();
              params.set("from", f);
              params.set("to", t);
            } else {
              params.set("period", next);
              params.delete("from");
              params.delete("to");
            }
            pushParams(params);
          }}
        >
          {F1_PERIOD_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      {value === "custom" ? (
        <HealthCustomRangeCalendar
          key={`${fromUrl}|${toUrl}`}
          className="w-full basis-full"
          fromDefault={fromUrl || startOfCurrentMonth()}
          toDefault={toUrl || todayYmd()}
          onApply={(from, to) => {
            const params = new URLSearchParams(searchParams.toString());
            params.set("period", "custom");
            params.set("from", from);
            params.set("to", to);
            pushParams(params);
          }}
        />
      ) : null}
    </div>
  );
}
