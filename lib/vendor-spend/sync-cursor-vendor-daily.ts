/**
 * Upsert VendorDailySpend from Cursor Team Admin API for a lookback window.
 */

import { Product, type PrismaClient } from "@prisma/client";
import { DecisionType } from "@prisma/client";
import {
  CURSOR_TEAM_ADMIN_VENDOR_KEY,
  fetchCursorFilteredUsageByUtcDay,
  resolveCursorTeamAdminApiKey,
} from "@/lib/integrations/cursor/team-admin-usage";

import {
  CURSOR_VENDOR_MAX_BACKFILL_DAYS,
  CURSOR_VENDOR_SYNC_CHUNK_DAYS,
  cursorVendorBackfillChunks,
  cursorVendorSyncWindowMs,
} from "./cursor-vendor-sync-windows";

export {
  CURSOR_VENDOR_SYNC_CHUNK_DAYS,
  CURSOR_VENDOR_MANUAL_MAX_LOOKBACK_DAYS,
  CURSOR_VENDOR_MAX_BACKFILL_DAYS,
  CURSOR_VENDOR_DEFAULT_BACKFILL_DAYS,
  cursorVendorBackfillChunks,
  cursorVendorSyncWindowMs,
} from "./cursor-vendor-sync-windows";
export type { CursorVendorSyncChunk } from "./cursor-vendor-sync-windows";

export type CursorVendorSyncResult = {
  daysUpserted: number;
  totalEvents: number;
  windowStartMs: number;
  windowEndMs: number;
  lookbackDays: number;
  endOffsetDays: number;
};

export type CursorVendorBackfillResult = {
  chunksRun: number;
  daysUpserted: number;
  totalEvents: number;
  totalLookbackDays: number;
  chunkDays: number;
};

function ymdToPrismaDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/**
 * Pull Cursor usage for an explicit or offset window, upsert VendorDailySpend.
 */
export async function syncCursorVendorDailySpendWindow(
  prisma: PrismaClient,
  args: {
    lookbackDays: number;
    endOffsetDays?: number;
    actorEmail: string;
    skipDecision?: boolean;
    nowMs?: number;
  },
): Promise<CursorVendorSyncResult> {
  const key = resolveCursorTeamAdminApiKey();
  if (!key) {
    throw new Error(
      "CURSOR_TEAM_ADMIN_API_KEY or CURSOR_ADMIN_TOKEN must be set to sync Cursor vendor spend.",
    );
  }

  const { startMs, endMs, lookbackDays, endOffsetDays } = cursorVendorSyncWindowMs({
    lookbackDays: args.lookbackDays,
    endOffsetDays: args.endOffsetDays,
    nowMs: args.nowMs,
  });

  const buckets = await fetchCursorFilteredUsageByUtcDay({
    startMs,
    endMs,
    opts: { apiKey: key },
  });

  let totalEvents = 0;
  for (const b of buckets.values()) totalEvents += b.eventCount;

  const now = new Date();
  for (const [ymd, b] of buckets) {
    const day = ymdToPrismaDate(ymd);
    await prisma.vendorDailySpend.upsert({
      where: {
        vendor_product_day: {
          vendor: CURSOR_TEAM_ADMIN_VENDOR_KEY,
          product: Product.CURSOR,
          day,
        },
      },
      create: {
        vendor: CURSOR_TEAM_ADMIN_VENDOR_KEY,
        product: Product.CURSOR,
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

  if (!args.skipDecision) {
    await prisma.decision.create({
      data: {
        type: DecisionType.CURSOR_VENDOR_SPEND_SYNC,
        beforeState: "{}",
        afterState: JSON.stringify({
          daysUpserted: buckets.size,
          totalEvents,
          windowStartMs: startMs,
          windowEndMs: endMs,
          lookbackDays,
          endOffsetDays,
        }),
        actorEmail: args.actorEmail,
        justification: `Cursor Team Admin API: ${buckets.size} UTC day bucket(s), ${totalEvents} usage event(s), window endOffset ${endOffsetDays}d lookback ${lookbackDays}d`,
      },
    });
  }

  return {
    daysUpserted: buckets.size,
    totalEvents,
    windowStartMs: startMs,
    windowEndMs: endMs,
    lookbackDays,
    endOffsetDays,
  };
}

/** @deprecated Prefer {@link syncCursorVendorDailySpendWindow}. */
export async function syncCursorVendorDailySpend(
  prisma: PrismaClient,
  args: {
    lookbackDays: number;
    actorEmail: string;
    skipDecision?: boolean;
  },
): Promise<CursorVendorSyncResult> {
  return syncCursorVendorDailySpendWindow(prisma, {
    lookbackDays: args.lookbackDays,
    endOffsetDays: 0,
    actorEmail: args.actorEmail,
    skipDecision: args.skipDecision,
  });
}

/**
 * Run chunked backfill in-process (scripts / tests). HTTP callers should loop
 * per-chunk requests to stay under App Service timeouts.
 */
export async function syncCursorVendorDailySpendBackfill(
  prisma: PrismaClient,
  args: {
    totalLookbackDays: number;
    actorEmail: string;
    chunkDays?: number;
  },
): Promise<CursorVendorBackfillResult> {
  const chunks = cursorVendorBackfillChunks(args.totalLookbackDays, args.chunkDays);
  let daysUpserted = 0;
  let totalEvents = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const result = await syncCursorVendorDailySpendWindow(prisma, {
      lookbackDays: chunk.lookbackDays,
      endOffsetDays: chunk.endOffsetDays,
      actorEmail: args.actorEmail,
      skipDecision: true,
    });
    daysUpserted += result.daysUpserted;
    totalEvents += result.totalEvents;
  }

  const totalLookbackDays = Math.min(
    Math.max(Math.floor(args.totalLookbackDays), 1),
    CURSOR_VENDOR_MAX_BACKFILL_DAYS,
  );
  const chunkDays = args.chunkDays ?? CURSOR_VENDOR_SYNC_CHUNK_DAYS;

  await prisma.decision.create({
    data: {
      type: DecisionType.CURSOR_VENDOR_SPEND_SYNC,
      beforeState: "{}",
      afterState: JSON.stringify({
        backfill: true,
        chunksRun: chunks.length,
        daysUpserted,
        totalEvents,
        totalLookbackDays,
        chunkDays,
      }),
      actorEmail: args.actorEmail,
      justification: `Cursor Team Admin API backfill: ${chunks.length} chunk(s), ${daysUpserted} day bucket(s), ${totalEvents} event(s), ${totalLookbackDays}d history`,
    },
  });

  return {
    chunksRun: chunks.length,
    daysUpserted,
    totalEvents,
    totalLookbackDays,
    chunkDays,
  };
}
