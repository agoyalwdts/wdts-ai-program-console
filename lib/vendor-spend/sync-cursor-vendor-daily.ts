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

export type CursorVendorSyncResult = {
  daysUpserted: number;
  totalEvents: number;
  windowStartMs: number;
  windowEndMs: number;
};

function ymdToPrismaDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/**
 * Pull Cursor usage events for [now - lookbackDays, now], bucket by UTC day,
 * upsert VendorDailySpend rows, append Decision.
 */
export async function syncCursorVendorDailySpend(
  prisma: PrismaClient,
  args: {
    lookbackDays: number;
    actorEmail: string;
    /** Skip Decision row (e.g. tests). */
    skipDecision?: boolean;
  },
): Promise<CursorVendorSyncResult> {
  const key = resolveCursorTeamAdminApiKey();
  if (!key) {
    throw new Error(
      "CURSOR_TEAM_ADMIN_API_KEY or CURSOR_ADMIN_TOKEN must be set to sync Cursor vendor spend.",
    );
  }

  const lookbackDays = Math.min(Math.max(args.lookbackDays, 1), 400);
  const endMs = Date.now();
  const startMs = endMs - lookbackDays * 24 * 60 * 60 * 1000;

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
        }),
        actorEmail: args.actorEmail,
        justification: `Cursor Team Admin API: ${buckets.size} UTC day bucket(s), ${totalEvents} usage event(s), lookback ${lookbackDays}d`,
      },
    });
  }

  return {
    daysUpserted: buckets.size,
    totalEvents,
    windowStartMs: startMs,
    windowEndMs: endMs,
  };
}
