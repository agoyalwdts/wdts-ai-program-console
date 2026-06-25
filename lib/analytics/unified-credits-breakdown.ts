/**
 * Aggregate SKU / model / surface from Unified Credits COSTS snapshots in a window.
 */

import type { PrismaClient } from "@prisma/client";
import { UNIFIED_CREDITS_SNAPSHOT_KIND } from "@/lib/integrations/unified-credits/constants";
import type { UnifiedCreditsRow } from "@/lib/integrations/unified-credits/types";
import { OPENAI_CREDIT_OVERAGE_USD } from "@/lib/program";

export type UnifiedCreditsBreakdownRow = {
  key: string;
  credits: number;
  usd: number;
  eventCount: number;
};

export type UnifiedCreditsBreakdown = {
  bySku: UnifiedCreditsBreakdownRow[];
  byModel: UnifiedCreditsBreakdownRow[];
  bySurface: UnifiedCreditsBreakdownRow[];
  totalCredits: number;
  snapshotDays: number;
};

function bump(
  map: Map<string, { credits: number; events: number }>,
  key: string,
  credits: number,
): void {
  const k = key.trim() || "unknown";
  const prev = map.get(k) ?? { credits: 0, events: 0 };
  prev.credits += credits;
  prev.events += 1;
  map.set(k, prev);
}

function mapToRows(
  map: Map<string, { credits: number; events: number }>,
  usdPerCredit: number,
): UnifiedCreditsBreakdownRow[] {
  return [...map.entries()]
    .map(([key, v]) => ({
      key,
      credits: v.credits,
      usd: v.credits * usdPerCredit,
      eventCount: v.events,
    }))
    .sort((a, b) => b.credits - a.credits);
}

export function aggregateUnifiedCreditsRows(
  rows: UnifiedCreditsRow[],
  usdPerCredit = OPENAI_CREDIT_OVERAGE_USD,
): Omit<UnifiedCreditsBreakdown, "snapshotDays"> {
  const bySku = new Map<string, { credits: number; events: number }>();
  const byModel = new Map<string, { credits: number; events: number }>();
  const bySurface = new Map<string, { credits: number; events: number }>();
  let totalCredits = 0;

  for (const row of rows) {
    totalCredits += row.credits_total;
    for (const line of row.billing) {
      bump(bySku, line.sku, line.credits);
    }
    bump(byModel, row.model ?? "unknown", row.credits_total);
    bump(bySurface, row.surface ?? row.client ?? "unknown", row.credits_total);
  }

  return {
    bySku: mapToRows(bySku, usdPerCredit),
    byModel: mapToRows(byModel, usdPerCredit),
    bySurface: mapToRows(bySurface, usdPerCredit),
    totalCredits,
  };
}

export async function loadUnifiedCreditsBreakdown(
  prisma: PrismaClient,
  args: { periodStart: Date; periodEnd: Date },
): Promise<UnifiedCreditsBreakdown | null> {
  const snaps = await prisma.programVendorExportSnapshot.findMany({
    where: {
      kind: UNIFIED_CREDITS_SNAPSHOT_KIND,
      periodStart: { gte: args.periodStart, lte: args.periodEnd },
    },
    orderBy: { createdAt: "desc" },
    select: { payload: true, periodStart: true },
    take: 120,
  });

  if (snaps.length === 0) return null;

  const rows: UnifiedCreditsRow[] = [];
  const seenDays = new Set<string>();
  for (const snap of snaps) {
    const day = snap.periodStart?.toISOString().slice(0, 10);
    if (day) seenDays.add(day);
    const payloadRows = (snap.payload as { rows?: UnifiedCreditsRow[] } | null)?.rows ?? [];
    rows.push(...payloadRows);
  }

  if (rows.length === 0) return null;

  const agg = aggregateUnifiedCreditsRows(rows);
  return { ...agg, snapshotDays: seenDays.size };
}
