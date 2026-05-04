/**
 * Program Health (F1) reporting window: calendar month / quarter / year to date.
 */

export type F1Period = "month" | "quarter" | "year";

export const F1_PERIOD_OPTIONS: { value: F1Period; label: string }[] = [
  { value: "month", label: "This month" },
  { value: "quarter", label: "This quarter" },
  { value: "year", label: "This year" },
];

export function parseF1Period(raw: string | string[] | undefined): F1Period {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (s === "quarter" || s === "year") return s;
  return "month";
}

export type F1PeriodPlan = {
  periodStart: Date;
  periodEnd: Date;
  /** Multiply monthly program budgets by this for the selected window. */
  budgetMonthMultiplier: number;
  chartTitle: string;
  rangeDescription: string;
};

function startOfQuarter(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3, 1);
}

/**
 * Inclusive-ish window: [periodStart, periodEnd] with periodEnd = `now`.
 * Budget bars scale monthly envelopes by `budgetMonthMultiplier`.
 */
export function planF1Period(now: Date, period: F1Period): F1PeriodPlan {
  const periodEnd = now;

  if (period === "month") {
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
      periodStart,
      periodEnd,
      budgetMonthMultiplier: 1,
      chartTitle: "Daily spend this month",
      rangeDescription: formatRange(periodStart, periodEnd),
    };
  }

  if (period === "quarter") {
    const periodStart = startOfQuarter(now);
    return {
      periodStart,
      periodEnd,
      budgetMonthMultiplier: 3,
      chartTitle: "Daily spend this quarter",
      rangeDescription: formatRange(periodStart, periodEnd),
    };
  }

  const periodStart = new Date(now.getFullYear(), 0, 1);
  return {
    periodStart,
    periodEnd,
    budgetMonthMultiplier: 12,
    chartTitle: "Daily spend this year",
    rangeDescription: formatRange(periodStart, periodEnd),
  };
}

function formatRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
  return `${start.toLocaleDateString("en-US", opts)} — ${end.toLocaleDateString("en-US", opts)}`;
}

/** Short label for aggregate spend vs budget in the selected window. */
export function f1PeriodSpendLabel(period: F1Period): string {
  if (period === "month") return "Month to date";
  if (period === "quarter") return "Quarter to date";
  return "Year to date";
}
