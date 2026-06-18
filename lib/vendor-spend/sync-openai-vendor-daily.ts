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
import {
  OPENAI_VENDOR_MAX_BACKFILL_DAYS,
  OPENAI_VENDOR_SYNC_CHUNK_DAYS,
  openAiVendorBackfillChunks,
  openAiVendorSyncWindowMs,
} from "./openai-vendor-sync-windows";

export {
  OPENAI_VENDOR_SYNC_CHUNK_DAYS,
  OPENAI_VENDOR_MANUAL_MAX_LOOKBACK_DAYS,
  OPENAI_VENDOR_MAX_BACKFILL_DAYS,
  OPENAI_VENDOR_DEFAULT_BACKFILL_DAYS,
  openAiVendorBackfillChunks,
  openAiVendorSyncWindowMs,
} from "./openai-vendor-sync-windows";
export type { OpenAiVendorSyncChunk } from "./openai-vendor-sync-windows";

export type OpenAiVendorSyncResult = {
  daysUpserted: number;
  totalCostRows: number;
  windowStartMs: number;
  windowEndMs: number;
  lookbackDays: number;
  endOffsetDays: number;
};

export type OpenAiVendorBackfillResult = {
  chunksRun: number;
  daysUpserted: number;
  totalCostRows: number;
  totalLookbackDays: number;
  chunkDays: number;
};

function ymdToPrismaDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

type SyncWindowArgs = {
  lookbackDays: number;
  endOffsetDays?: number;
  actorEmail: string;
  skipDecision?: boolean;
  nowMs?: number;
  credsOverride?: { apiKey: string; orgId: string };
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
};

/**
 * Pull organization costs for one window, bucket by local day and product,
 * upsert VendorDailySpend rows.
 */
export async function syncOpenAiVendorDailySpendWindow(
  prisma: PrismaClient,
  args: SyncWindowArgs,
): Promise<OpenAiVendorSyncResult> {
  const env = args.env ?? process.env;
  const creds = args.credsOverride ?? resolveOpenAiCostsCredentials(env);
  if (!creds) {
    throw new Error(
      "OPENAI_ADMIN_API_KEY and OPENAI_ORG_ID must be set to sync OpenAI vendor spend.",
    );
  }

  const { startMs, endMs, lookbackDays, endOffsetDays } = openAiVendorSyncWindowMs({
    lookbackDays: args.lookbackDays,
    endOffsetDays: args.endOffsetDays,
    nowMs: args.nowMs,
  });
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
          endOffsetDays,
          distinctLocalDays: byDay.size,
        }),
        actorEmail: args.actorEmail,
        justification: `OpenAI organization/costs: ${daysUpserted} VendorDailySpend row(s), ${totalCostRows} cost line(s), endOffset ${endOffsetDays}d lookback ${lookbackDays}d`,
      },
    });
  }

  return {
    daysUpserted,
    totalCostRows,
    windowStartMs: startMs,
    windowEndMs: endMs,
    lookbackDays,
    endOffsetDays,
  };
}

/** @deprecated Prefer {@link syncOpenAiVendorDailySpendWindow}. */
export async function syncOpenAiVendorDailySpend(
  prisma: PrismaClient,
  args: Omit<SyncWindowArgs, "endOffsetDays"> & { endOffsetDays?: number },
): Promise<OpenAiVendorSyncResult> {
  return syncOpenAiVendorDailySpendWindow(prisma, {
    lookbackDays: args.lookbackDays,
    endOffsetDays: args.endOffsetDays ?? 0,
    actorEmail: args.actorEmail,
    skipDecision: args.skipDecision,
    nowMs: args.nowMs,
    credsOverride: args.credsOverride,
    env: args.env,
    fetchImpl: args.fetchImpl,
  });
}

/**
 * Run chunked backfill in-process (scripts / tests). HTTP callers should loop
 * per-chunk requests to stay under App Service timeouts.
 */
export async function syncOpenAiVendorDailySpendBackfill(
  prisma: PrismaClient,
  args: {
    totalLookbackDays: number;
    actorEmail: string;
    chunkDays?: number;
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
  },
): Promise<OpenAiVendorBackfillResult> {
  const chunks = openAiVendorBackfillChunks(args.totalLookbackDays, args.chunkDays);
  let daysUpserted = 0;
  let totalCostRows = 0;

  for (const chunk of chunks) {
    const result = await syncOpenAiVendorDailySpendWindow(prisma, {
      lookbackDays: chunk.lookbackDays,
      endOffsetDays: chunk.endOffsetDays,
      actorEmail: args.actorEmail,
      skipDecision: true,
      env: args.env,
      fetchImpl: args.fetchImpl,
    });
    daysUpserted += result.daysUpserted;
    totalCostRows += result.totalCostRows;
  }

  const totalLookbackDays = Math.min(
    Math.max(Math.floor(args.totalLookbackDays), 1),
    OPENAI_VENDOR_MAX_BACKFILL_DAYS,
  );
  const chunkDays = args.chunkDays ?? OPENAI_VENDOR_SYNC_CHUNK_DAYS;

  await prisma.decision.create({
    data: {
      type: DecisionType.OPENAI_VENDOR_SPEND_SYNC,
      beforeState: "{}",
      afterState: JSON.stringify({
        backfill: true,
        chunksRun: chunks.length,
        daysUpserted,
        totalCostRows,
        totalLookbackDays,
        chunkDays,
      }),
      actorEmail: args.actorEmail,
      justification: `OpenAI organization/costs backfill: ${chunks.length} chunk(s), ${daysUpserted} VendorDailySpend row(s), ${totalCostRows} cost line(s), ${totalLookbackDays}d history`,
    },
  });

  return {
    chunksRun: chunks.length,
    daysUpserted,
    totalCostRows,
    totalLookbackDays,
    chunkDays,
  };
}
