/**
 * Live OpenAI organization/costs fetch for F1 — billing-aligned credit envelope.
 *
 * The Credits tab in OpenAI Admin tracks consumption; Workspace Analytics can
 * undercount. organization/costs returns USD by product (ChatGPT vs Codex).
 */

import { Product } from "@prisma/client";
import { getIntegrationMode } from "@/lib/integrations/env";
import { buildCostLineItemClassifier } from "@/lib/integrations/openai/cost-line-item";
import {
  fetchOpenAiOrgCostsByLocalDay,
  resolveOpenAiCostsCredentials,
} from "@/lib/integrations/openai/org-costs";
import { localYmd } from "@/lib/f1-cursor-vendor";

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function enumerateDays(periodStart: Date, periodEnd: Date): Date[] {
  const startDay = startOfLocalDay(periodStart);
  const endDay = startOfLocalDay(periodEnd);
  if (startDay.getTime() > endDay.getTime()) return [];
  const out: Date[] = [];
  for (let d = new Date(startDay); d.getTime() <= endDay.getTime(); d.setDate(d.getDate() + 1)) {
    out.push(new Date(d));
  }
  return out;
}

export type OpenAiOrgCostsPeriodEnvelope = {
  chatgptUsd: number;
  codexUsd: number;
  totalUsd: number;
  source: "live";
};

/** Sum organization/costs ChatGPT + Codex USD for the F1 window (live API). */
export async function fetchOpenAiOrgCostsPeriodEnvelope(args: {
  periodStart: Date;
  periodEnd: Date;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<OpenAiOrgCostsPeriodEnvelope | null> {
  const env = args.env ?? process.env;
  if (getIntegrationMode("openai", env) !== "real") return null;

  const creds = resolveOpenAiCostsCredentials(env);
  if (!creds) return null;

  const startTimeSec = Math.floor(args.periodStart.getTime() / 1000);
  const endTimeSec = Math.floor(args.periodEnd.getTime() / 1000);
  if (endTimeSec <= startTimeSec) {
    return { chatgptUsd: 0, codexUsd: 0, totalUsd: 0, source: "live" };
  }

  try {
    const classifier = buildCostLineItemClassifier(env);
    const { byDay } = await fetchOpenAiOrgCostsByLocalDay({
      startTimeSec,
      endTimeSec,
      creds,
      classifier,
      toLocalYmd: (utcMs) => localYmd(new Date(utcMs)),
      fetchImpl: args.fetchImpl ?? globalThis.fetch.bind(globalThis),
      maxPages: 200,
    });

    let chatgptUsd = 0;
    let codexUsd = 0;
    for (const day of enumerateDays(args.periodStart, args.periodEnd)) {
      const ymd = localYmd(day);
      const row = byDay.get(ymd);
      if (!row) continue;
      chatgptUsd += row[Product.CHATGPT].spendUsd;
      codexUsd += row[Product.CODEX].spendUsd;
    }

    return {
      chatgptUsd,
      codexUsd,
      totalUsd: chatgptUsd + codexUsd,
      source: "live",
    };
  } catch (err) {
    console.error("[f1/openai-org-costs-live] organization/costs fetch failed", err);
    return null;
  }
}
