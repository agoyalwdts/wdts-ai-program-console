/**
 * Program Health (F1) reporting window: calendar month / quarter / year / custom range.
 */

import { startOfOpenAiChatGptCodexBillingPeriod } from "@/lib/openai-billing-period";

export type F1Period = "month" | "quarter" | "year" | "custom";

export const F1_PERIOD_OPTIONS: { value: F1Period; label: string }[] = [
  { value: "month", label: "This month" },
  { value: "quarter", label: "This quarter" },
  { value: "year", label: "This year" },
  { value: "custom", label: "Custom range" },
];

/** Inclusive span cap for custom F1 windows (server clamps longer URLs). */
export const MAX_CUSTOM_RANGE_DAYS = 400;

export function parseF1Period(raw: string | string[] | undefined): F1Period {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (s === "quarter" || s === "year" || s === "custom") return s;
  return "month";
}

/** YYYY-MM-DD → local calendar Date at 00:00:00, or null if invalid. */
export function parseLocalYmd(raw: string | undefined): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return null;
  const [y, m, d] = raw.trim().split("-").map(Number);
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt;
}

export function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/**
 * Custom [from, to] inclusive in local time. End is capped to `now` and span to MAX_CUSTOM_RANGE_DAYS.
 * Invalid/missing dates fall back to “this month to date”.
 */
export function planF1CustomPeriod(
  now: Date,
  fromYmd: string | undefined,
  toYmd: string | undefined,
): F1PeriodPlan {
  let from = parseLocalYmd(fromYmd);
  let to = parseLocalYmd(toYmd);
  if (!from || !to) {
    const fallbackStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
      periodStart: startOfLocalDay(fallbackStart),
      periodEnd: now,
      budgetMonthMultiplier: 1,
      chartTitle: "Daily spend this month",
      rangeDescription: formatRange(fallbackStart, now),
    };
  }
  from = startOfLocalDay(from);
  to = startOfLocalDay(to);
  if (from.getTime() > to.getTime()) {
    const t = from;
    from = to;
    to = t;
  }
  const spanDays =
    Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  if (spanDays > MAX_CUSTOM_RANGE_DAYS) {
    to = new Date(from);
    to.setDate(to.getDate() + MAX_CUSTOM_RANGE_DAYS - 1);
  }
  let periodEnd = endOfLocalDay(to);
  if (periodEnd.getTime() > now.getTime()) {
    periodEnd = now;
  }
  if (periodEnd.getTime() < from.getTime()) {
    periodEnd = now;
  }
  const avgDaysPerMonth = 30.4375;
  const effectiveDays = Math.max(
    1,
    Math.floor((startOfLocalDay(periodEnd).getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1,
  );
  const budgetMonthMultiplier = effectiveDays / avgDaysPerMonth;
  return {
    periodStart: from,
    periodEnd,
    budgetMonthMultiplier,
    chartTitle: "Daily spend (custom range)",
    rangeDescription: formatRange(from, periodEnd),
  };
}

export type F1PeriodPlan = {
  periodStart: Date;
  periodEnd: Date;
  /** Multiply monthly program budgets by this for the selected window. */
  budgetMonthMultiplier: number;
  chartTitle: string;
  /** Calendar (or custom) window — Cursor, Claude, M365, gateway default. */
  rangeDescription: string;
  /**
   * ChatGPT/Codex billing window when it differs from {@link rangeDescription}
   * (“This month” uses plan renewal on the 16th).
   */
  openAiRangeDescription?: string;
};

/** Shared date span label for F1 headers and OpenAI product cards. */
export function formatF1DateRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
  return `${start.toLocaleDateString("en-US", opts)} — ${end.toLocaleDateString("en-US", opts)}`;
}

function startOfQuarter(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3, 1);
}

/**
 * Inclusive-ish window: [periodStart, periodEnd] with periodEnd = `now`.
 * Budget bars scale monthly envelopes by `budgetMonthMultiplier`.
 */
export function planF1Period(now: Date, period: Exclude<F1Period, "custom">): F1PeriodPlan {
  const periodEnd = now;

  if (period === "month") {
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const billingStart = startOfOpenAiChatGptCodexBillingPeriod(now);
    const calendarRange = formatF1DateRange(periodStart, periodEnd);
    const billingRange = formatF1DateRange(billingStart, periodEnd);
    return {
      periodStart,
      periodEnd,
      budgetMonthMultiplier: 1,
      chartTitle: "Daily spend this month",
      rangeDescription: calendarRange,
      openAiRangeDescription:
        billingStart.getTime() === periodStart.getTime() ? undefined : billingRange,
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
  return formatF1DateRange(start, end);
}

/** Short label for aggregate spend vs budget in the selected window. */
export function f1PeriodSpendLabel(period: F1Period): string {
  if (period === "month") return "Month to date";
  if (period === "quarter") return "Quarter to date";
  if (period === "year") return "Year to date";
  return "Custom range";
}

export type F1SearchParams = {
  period?: string | string[];
  from?: string | string[];
  to?: string | string[];
};

function firstString(v: string | string[] | undefined): string | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

/** Resolve plan + period from URL search params (server). */
export function resolveF1PlanFromSearchParams(now: Date, sp: F1SearchParams): {
  plan: F1PeriodPlan;
  period: F1Period;
} {
  const period = parseF1Period(firstString(sp.period));
  if (period === "custom") {
    return {
      plan: planF1CustomPeriod(now, firstString(sp.from), firstString(sp.to)),
      period: "custom",
    };
  }
  return { plan: planF1Period(now, period), period };
}
