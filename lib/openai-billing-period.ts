/**
 * ChatGPT + Codex share one OpenAI Enterprise monthly plan; WDTS renews on the
 * 16th (not calendar month). Use these helpers for MTD, caps, and F1 month view.
 */

/** Day-of-month (local) when the ChatGPT/Codex plan period starts. */
export const OPENAI_CHATGPT_CODEX_BILLING_ANCHOR_DAY = 16;

/** Inclusive start of the current ChatGPT/Codex billing period (local midnight). */
export function startOfOpenAiChatGptCodexBillingPeriod(now: Date): Date {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  if (d >= OPENAI_CHATGPT_CODEX_BILLING_ANCHOR_DAY) {
    return new Date(y, m, OPENAI_CHATGPT_CODEX_BILLING_ANCHOR_DAY, 0, 0, 0, 0);
  }
  return new Date(y, m - 1, OPENAI_CHATGPT_CODEX_BILLING_ANCHOR_DAY, 0, 0, 0, 0);
}

/** Exclusive end of the current billing period (start of the next period). */
export function endOfOpenAiChatGptCodexBillingPeriod(now: Date): Date {
  const start = startOfOpenAiChatGptCodexBillingPeriod(now);
  return new Date(start.getFullYear(), start.getMonth() + 1, OPENAI_CHATGPT_CODEX_BILLING_ANCHOR_DAY, 0, 0, 0, 0);
}

/** Unix seconds (inclusive) for analytics / API windows. */
export function openAiBillingPeriodStartSec(now: Date): number {
  return Math.floor(startOfOpenAiChatGptCodexBillingPeriod(now).getTime() / 1000);
}

/**
 * F1 “this month” uses calendar month for Cursor et al.; ChatGPT/Codex use the
 * billing anchor. Quarter/year/custom keep the selected plan start.
 */
export function openAiChatGptCodexPeriodStartForF1(
  now: Date,
  period: "month" | "quarter" | "year" | "custom",
  planPeriodStart: Date,
): Date {
  if (period === "month") return startOfOpenAiChatGptCodexBillingPeriod(now);
  return planPeriodStart;
}

/** Earliest `since` for gateway daily series when F1 month view includes pre-anchor days. */
export function f1GatewayDailySinceForMonthView(planPeriodStart: Date, now: Date): Date {
  const billingStart = startOfOpenAiChatGptCodexBillingPeriod(now);
  return new Date(Math.min(planPeriodStart.getTime(), billingStart.getTime()));
}

/** F1 / product cards: spend label for ChatGPT & Codex when the window is “this month”. */
export function f1OpenAiSpendLabel(period: "month" | "quarter" | "year" | "custom", now: Date): string {
  if (period === "month") return `Plan period · ${describeOpenAiBillingPeriodToDate(now)}`;
  if (period === "quarter") return "Quarter to date";
  if (period === "year") return "Year to date";
  return "Custom range";
}

/** Short label for UI footnotes (e.g. “Apr 16 – today”). */
export function describeOpenAiBillingPeriodToDate(now: Date): string {
  const start = startOfOpenAiChatGptCodexBillingPeriod(now);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const startStr = start.toLocaleDateString("en-US", opts);
  const endStr = now.toLocaleDateString("en-US", { ...opts, year: "numeric" });
  return `${startStr} – ${endStr}`;
}
