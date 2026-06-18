/**
 * OpenAI (ChatGPT + Codex) spend window on F1 — independent of the page period
 * when the operator picks “Current billing cycle” on the OpenAI card.
 */

import {
  f1PeriodSpendLabel,
  formatF1DateRange,
  type F1Period,
  type F1PeriodPlan,
} from "@/lib/f1-period";
import {
  describeOpenAiBillingPeriodToDate,
  startOfOpenAiChatGptCodexBillingPeriod,
} from "@/lib/openai-billing-period";

export type OpenAiF1Window = "follow" | "billing";

export const OPENAI_F1_WINDOW_OPTIONS: { value: OpenAiF1Window; label: string }[] = [
  { value: "follow", label: "Match page period" },
  { value: "billing", label: "Current billing cycle" },
];

export function parseOpenAiF1Window(raw: string | string[] | undefined): OpenAiF1Window {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return s === "billing" ? "billing" : "follow";
}

export type OpenAiF1SpendPlan = {
  periodStart: Date;
  periodEnd: Date;
  /** Multiply monthly OpenAI credit envelopes by this for the selected window. */
  budgetMonthMultiplier: number;
  rangeDescription: string;
  spendLabel: string;
};

export function planOpenAiF1Spend(args: {
  now: Date;
  period: F1Period;
  pagePlan: F1PeriodPlan;
  window: OpenAiF1Window;
}): OpenAiF1SpendPlan {
  if (args.window === "billing") {
    const periodStart = startOfOpenAiChatGptCodexBillingPeriod(args.now);
    const periodEnd = args.pagePlan.periodEnd;
    return {
      periodStart,
      periodEnd,
      budgetMonthMultiplier: 1,
      rangeDescription: formatF1DateRange(periodStart, periodEnd),
      spendLabel: `Billing cycle · ${describeOpenAiBillingPeriodToDate(args.now)}`,
    };
  }

  return {
    periodStart: args.pagePlan.periodStart,
    periodEnd: args.pagePlan.periodEnd,
    budgetMonthMultiplier: args.pagePlan.budgetMonthMultiplier,
    rangeDescription: args.pagePlan.rangeDescription,
    spendLabel: f1PeriodSpendLabel(args.period),
  };
}
