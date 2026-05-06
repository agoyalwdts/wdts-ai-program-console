"use client";

import { useCallback, useState } from "react";
import { DayPicker, type DateRange } from "react-day-picker";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  formatLocalYmd,
  MAX_CUSTOM_RANGE_DAYS,
  parseLocalYmd,
} from "@/lib/f1-period";
import { cn } from "@/lib/utils";

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function inclusiveSpanDays(from: Date, to: Date): number {
  const a = startOfLocalDay(from).getTime();
  const b = startOfLocalDay(to).getTime();
  return Math.floor((b - a) / (24 * 60 * 60 * 1000)) + 1;
}

function isFutureLocalDay(date: Date): boolean {
  const today = startOfLocalDay(new Date());
  return startOfLocalDay(date).getTime() > today.getTime();
}

function initialRangeFromDefaults(
  fromDefault: string,
  toDefault: string,
): DateRange | undefined {
  const from = parseLocalYmd(fromDefault);
  const to = parseLocalYmd(toDefault);
  if (!from && !to) return undefined;
  return { from: from ?? undefined, to: to ?? undefined };
}

function formatRangeLabel(range: DateRange | undefined): string {
  if (!range?.from) return "Click a start date, then an end date.";
  if (!range.to) return `${format(range.from, "MMM d, yyyy")} — pick end date`;
  return `${format(range.from, "MMM d, yyyy")} — ${format(range.to, "MMM d, yyyy")}`;
}

export function HealthCustomRangeCalendar({
  fromDefault,
  toDefault,
  onApply,
  className,
}: {
  fromDefault: string;
  toDefault: string;
  onApply: (from: string, to: string) => void;
  className?: string;
}) {
  const [range, setRange] = useState<DateRange | undefined>(() =>
    initialRangeFromDefaults(fromDefault, toDefault),
  );
  const [error, setError] = useState<string | null>(null);

  const handleSelect = useCallback((next: DateRange | undefined) => {
    setError(null);
    setRange(next);
  }, []);

  const defaultMonth = parseLocalYmd(fromDefault) ?? new Date();

  const handleApply = () => {
    if (!range?.from || !range.to) return;
    const span = inclusiveSpanDays(range.from, range.to);
    if (span > MAX_CUSTOM_RANGE_DAYS) {
      setError(
        `That range is ${span} days. Maximum is ${MAX_CUSTOM_RANGE_DAYS} days.`,
      );
      return;
    }
    onApply(formatLocalYmd(range.from), formatLocalYmd(range.to));
  };

  const canApply = Boolean(range?.from && range.to);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-md border border-slate-200 bg-white px-3 py-3 shadow-sm sm:px-4",
        className,
      )}
    >
      <DayPicker
        mode="range"
        weekStartsOn={1}
        numberOfMonths={1}
        defaultMonth={defaultMonth}
        selected={range}
        onSelect={handleSelect}
        disabled={isFutureLocalDay}
        resetOnSelect
        className="health-f1-day-picker mx-auto w-full max-w-md text-slate-900"
      />

      <div className="flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-600" aria-live="polite">
          {formatRangeLabel(range)}
        </p>
        <div className="flex flex-col items-stretch gap-1 sm:items-end">
          {error ? (
            <p className="text-xs text-red-600" role="alert">
              {error}
            </p>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-9 sm:min-w-[5.5rem]"
            disabled={!canApply}
            onClick={handleApply}
          >
            Apply
          </Button>
        </div>
      </div>
    </div>
  );
}
