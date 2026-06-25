/**
 * OpenAI billing period (16th→15th) helpers for COSTS rollups.
 */

import {
  endOfOpenAiChatGptCodexBillingPeriod,
  startOfOpenAiChatGptCodexBillingPeriod,
} from "@/lib/openai-billing-period";
import { formatLocalYmd } from "@/lib/f1-period";

export type OpenAiBillingPeriodBounds = {
  periodStart: Date;
  periodEndExclusive: Date;
  startYmd: string;
  endYmdInclusive: string;
};

export function openAiBillingPeriodBounds(now: Date = new Date()): OpenAiBillingPeriodBounds {
  const periodStart = startOfOpenAiChatGptCodexBillingPeriod(now);
  const periodEndExclusive = endOfOpenAiChatGptCodexBillingPeriod(now);
  const endInclusive = new Date(periodEndExclusive);
  endInclusive.setDate(endInclusive.getDate() - 1);
  if (endInclusive.getTime() > now.getTime()) {
    endInclusive.setTime(now.getTime());
  }
  return {
    periodStart,
    periodEndExclusive,
    startYmd: formatLocalYmd(periodStart),
    endYmdInclusive: formatLocalYmd(endInclusive),
  };
}

/** True when a COSTS row day (YYYY-MM-DD) falls in the current OpenAI billing period. */
export function costsDayInCurrentBillingPeriod(dayYmd: string, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayYmd)) return false;
  const bounds = openAiBillingPeriodBounds(now);
  return dayYmd >= bounds.startYmd && dayYmd <= bounds.endYmdInclusive;
}
