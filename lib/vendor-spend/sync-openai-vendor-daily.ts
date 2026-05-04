/**
 * Upsert VendorDailySpend from OpenAI Organization Costs API (ChatGPT vs Codex split).
 */

import { Product, type PrismaClient } from "@prisma/client";
import { DecisionType } from "@prisma/client";
import { buildCostLineItemClassifier } from "@/lib/integrations/openai/cost-line-item";
import {
  fetchOpenAiOrgCostsByLocalDay,
  OPENAI_ORG_COSTS_VENDOR_KEY,
  resolveOpenAiCostsCredentials,
} from "@/lib/integrations/openai/org-costs";
import { localYmd } from "@/lib/f1-cursor-vendor";

export type OpenAiVendorSyncResult = {
  daysUpserted: number;
  totalCostRows: number;
  windowStartMs: number;
  windowEndMs: number;
};

function ymdToPrismaDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/**
 * Pull organization costs for [now - lookbackDays, now], bucket by local day and
 * product, upsert VendorDailySpend rows, append Decision.
 */
export async function syncOpenAiVendorDailySpend(
  prisma: PrismaClient,
  args: {
    lookbackDays: number;
    actorEmail: string;
    skipDecision?: boolean;
    /** For tests — override env-derived credentials and classifier. */
    credsOverride?: { apiKey: string; orgId: string };
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
  },
): Promise<OpenAiVendorSyncResult> {
  const env = args.env ?? process.env;
  const creds = args.credsOverride ?? resolveOpenAiCostsCredentials(env);
  if (!creds) {
    throw new Error(
      "OPENAI_ADMIN_API_KEY and OPENAI_ORG_ID must be set to sync OpenAI vendor spend.",
    );
  }

  const lookbackDays = Math.min(Math.max(args.lookbackDays, 1), 400);
  const endMs = Date.now();
  const startMs = endMs - lookbackDays * 24 * 60 * 60 * 1000;
  const endTimeSec = Math.floor(endMs / 1000);
  const startTimeSec = Math.floor(startMs / 1000);

  const classifier = buildCostLineItemClassifier(env);
  const { byDay, sourceCostLines } = await fetchOpenAiOrgCostsByLocalDay({
    startTimeSec,
    endTimeSec,
    creds,
    classifier,
    toLocalYmd: (utcMs) => localYmd(new Date(utcMs)),
    fetchImpl: args.fetchImpl ?? globalThis.fetch.bind(globalThis),
  });

  const totalCostRows = sourceCostLines;

  const now = new Date();
  let daysUpserted = 0;
  for (const [ymd, agg] of byDay) {
    const day = ymdToPrismaDate(ymd);
    for (const product of [Product.CHATGPT, Product.CODEX] as const) {
      const b = agg[product];
      if (b.spendUsd === 0 && b.eventCount === 0) continue;
      daysUpserted += 1;
      await prisma.vendorDailySpend.upsert({
        where: {
          vendor_product_day: {
            vendor: OPENAI_ORG_COSTS_VENDOR_KEY,
            product,
            day,
          },
        },
        create: {
          vendor: OPENAI_ORG_COSTS_VENDOR_KEY,
          product,
          day,
          spendUsd: b.spendUsd,
          eventCount: b.eventCount,
          syncedAt: now,
        },
        update: {
          spendUsd: b.spendUsd,
          eventCount: b.eventCount,
          syncedAt: now,
        },
      });
    }
  }

  if (!args.skipDecision) {
    await prisma.decision.create({
      data: {
        type: DecisionType.OPENAI_VENDOR_SPEND_SYNC,
        beforeState: "{}",
        afterState: JSON.stringify({
          daysUpserted,
          totalCostRows,
          windowStartMs: startMs,
          windowEndMs: endMs,
          lookbackDays,
          distinctLocalDays: byDay.size,
        }),
        actorEmail: args.actorEmail,
        justification: `OpenAI organization/costs: ${daysUpserted} VendorDailySpend row(s), ${totalCostRows} cost line(s), lookback ${lookbackDays}d`,
      },
    });
  }

  return {
    daysUpserted,
    totalCostRows,
    windowStartMs: startMs,
    windowEndMs: endMs,
  };
}
