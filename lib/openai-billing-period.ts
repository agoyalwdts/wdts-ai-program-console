/**
 * ChatGPT + Codex share one OpenAI Enterprise monthly plan; WDTS renews on the
 * 16th (not calendar month). Used by Codex ladder, F2, and the F1 OpenAI card
 * billing-cycle selector — not the page-level “This month” period.
 */

import { formatF1DateRange } from "@/lib/f1-period";

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

/** Billing period start through today (Codex ladder, F1 billing-cycle window). */
export function describeOpenAiBillingPeriodToDate(now: Date): string {
  return formatF1DateRange(startOfOpenAiChatGptCodexBillingPeriod(now), now);
}
