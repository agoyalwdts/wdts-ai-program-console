/**
 * Portal-aligned OpenAI org credit envelope for F1 combined tile.
 *
 * OpenAI Admin → Credits (589.9K MTD) tracks billing-grade usage. Workspace
 * Analytics CHATGPT_USER_ANALYTICS is a beta user-analytics feed and can run
 * ~15–25% below the portal. Prefer Unified Credits COSTS, then org-costs API,
 * then WA pool for the combined envelope.
 */

import { Product, type PrismaClient } from "@prisma/client";
import type { OpenAiDailyMergedSpend } from "@/lib/f1-openai-daily-spend";
import { localYmd } from "@/lib/f1-cursor-vendor";
import { OPENAI_ORG_COSTS_VENDOR_KEY } from "@/lib/integrations/openai/org-costs";
import {
  UNIFIED_CREDITS_SNAPSHOT_KIND,
  UNIFIED_CREDITS_VENDOR_KEY,
} from "@/lib/integrations/unified-credits/constants";
import { productFromCostsRow } from "@/lib/integrations/unified-credits/ingest";
import type { UnifiedCreditsRow } from "@/lib/integrations/unified-credits/types";
import { WORKSPACE_ANALYTICS_USER_VENDOR_KEY } from "@/lib/integrations/workspace-analytics/vendor-key";
import { OPENAI_CREDIT_OVERAGE_USD } from "@/lib/program";

function vendorDayRange(periodStart: Date, periodEnd: Date): { rangeStart: Date; rangeEnd: Date } {
  const startDay = new Date(periodStart);
  startDay.setHours(0, 0, 0, 0);
  const endDay = new Date(periodEnd);
  endDay.setHours(0, 0, 0, 0);
  return {
    rangeStart: new Date(startDay.getFullYear(), startDay.getMonth(), startDay.getDate(), 12, 0, 0, 0),
    rangeEnd: new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate(), 12, 0, 0, 0),
  };
}

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

async function loadVendorUsdByYmd(
  prisma: PrismaClient,
  args: { periodStart: Date; periodEnd: Date; vendor: string; product: Product },
): Promise<Map<string, number>> {
  const { rangeStart, rangeEnd } = vendorDayRange(args.periodStart, args.periodEnd);
  const rows = await prisma.vendorDailySpend.findMany({
    where: {
      vendor: args.vendor,
      product: args.product,
      day: { gte: rangeStart, lte: rangeEnd },
    },
    select: { day: true, spendUsd: true },
  });
  const map = new Map<string, number>();
  for (const row of rows) {
    const ymd = localYmd(row.day);
    map.set(ymd, (map.get(ymd) ?? 0) + row.spendUsd);
  }
  return map;
}

function mergeMaxUsdByYmd(...maps: Map<string, number>[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const map of maps) {
    for (const [ymd, usd] of map) {
      out.set(ymd, Math.max(out.get(ymd) ?? 0, usd));
    }
  }
  return out;
}

function ymdInPeriod(ymd: string, periodStart: Date, periodEnd: Date): boolean {
  const day = startOfLocalDay(new Date(`${ymd}T12:00:00`));
  const start = startOfLocalDay(periodStart);
  const end = startOfLocalDay(periodEnd);
  return day.getTime() >= start.getTime() && day.getTime() <= end.getTime();
}

/** Unified COSTS rows from snapshot payloads (richer than VendorDailySpend alone). */
async function loadUnifiedCreditsLayersFromSnapshots(
  prisma: PrismaClient,
  args: { periodStart: Date; periodEnd: Date },
): Promise<{ unifiedChatByYmd: Map<string, number>; unifiedCodByYmd: Map<string, number> }> {
  const { rangeStart, rangeEnd } = vendorDayRange(args.periodStart, args.periodEnd);
  const snaps = await prisma.programVendorExportSnapshot.findMany({
    where: {
      kind: UNIFIED_CREDITS_SNAPSHOT_KIND,
      periodStart: { gte: rangeStart, lte: rangeEnd },
    },
    select: { payload: true },
  });

  const seenEventIds = new Set<string>();
  const unifiedChatByYmd = new Map<string, number>();
  const unifiedCodByYmd = new Map<string, number>();

  for (const snap of snaps) {
    const rows = (snap.payload as { rows?: UnifiedCreditsRow[] } | null)?.rows ?? [];
    for (const row of rows) {
      if (seenEventIds.has(row.event_id)) continue;
      if (!ymdInPeriod(row.day, args.periodStart, args.periodEnd)) continue;
      seenEventIds.add(row.event_id);

      const product = productFromCostsRow(row);
      if (!product || row.credits_total <= 0) continue;

      const usd = row.credits_total * OPENAI_CREDIT_OVERAGE_USD;
      const target = product === Product.CHATGPT ? unifiedChatByYmd : unifiedCodByYmd;
      target.set(row.day, (target.get(row.day) ?? 0) + usd);
    }
  }

  return { unifiedChatByYmd, unifiedCodByYmd };
}

export type OpenAiOrgEnvelopeLayers = {
  unifiedChatByYmd: Map<string, number>;
  unifiedCodByYmd: Map<string, number>;
  orgCostsChatByYmd: Map<string, number>;
  orgCostsCodByYmd: Map<string, number>;
  workspacePoolByYmd: Map<string, number>;
};

export async function loadOpenAiOrgEnvelopeLayers(
  prisma: PrismaClient,
  args: { periodStart: Date; periodEnd: Date },
): Promise<OpenAiOrgEnvelopeLayers> {
  const [unifiedChatVendor, unifiedCodVendor, orgCostsChatByYmd, orgCostsCodByYmd, workspacePoolByYmd, snapshotUnified] =
    await Promise.all([
      loadVendorUsdByYmd(prisma, {
        ...args,
        vendor: UNIFIED_CREDITS_VENDOR_KEY,
        product: Product.CHATGPT,
      }),
      loadVendorUsdByYmd(prisma, {
        ...args,
        vendor: UNIFIED_CREDITS_VENDOR_KEY,
        product: Product.CODEX,
      }),
      loadVendorUsdByYmd(prisma, {
        ...args,
        vendor: OPENAI_ORG_COSTS_VENDOR_KEY,
        product: Product.CHATGPT,
      }),
      loadVendorUsdByYmd(prisma, {
        ...args,
        vendor: OPENAI_ORG_COSTS_VENDOR_KEY,
        product: Product.CODEX,
      }),
      loadVendorUsdByYmd(prisma, {
        ...args,
        vendor: WORKSPACE_ANALYTICS_USER_VENDOR_KEY,
        product: Product.CHATGPT,
      }),
      loadUnifiedCreditsLayersFromSnapshots(prisma, args),
    ]);

  return {
    unifiedChatByYmd: mergeMaxUsdByYmd(unifiedChatVendor, snapshotUnified.unifiedChatByYmd),
    unifiedCodByYmd: mergeMaxUsdByYmd(unifiedCodVendor, snapshotUnified.unifiedCodByYmd),
    orgCostsChatByYmd,
    orgCostsCodByYmd,
    workspacePoolByYmd,
  };
}

/** Min daily USD on overlap days when deriving WA→portal uplift from unified COSTS. */
const MIN_OVERLAP_DAY_USD = 50;

/**
 * Fallback WA→portal uplift when unified and WA cover disjoint day ranges (no overlap
 * to measure). Derived from observed 504K WA vs 590K Admin Credits (Jun 2026).
 */
export const OPENAI_WA_PORTAL_UPLIFT_DEFAULT = 589_900 / 504_908;

function sumProductMapsInPeriod(args: {
  chatByYmd: Map<string, number>;
  codByYmd: Map<string, number>;
  periodStart: Date;
  periodEnd: Date;
}): number {
  let total = 0;
  for (const day of enumerateDays(args.periodStart, args.periodEnd)) {
    const ymd = localYmd(day);
    total += (args.chatByYmd.get(ymd) ?? 0) + (args.codByYmd.get(ymd) ?? 0);
  }
  return total;
}

function sumMapInPeriod(m: Map<string, number>, periodStart: Date, periodEnd: Date): number {
  let total = 0;
  for (const day of enumerateDays(periodStart, periodEnd)) {
    total += m.get(localYmd(day)) ?? 0;
  }
  return total;
}

/** Median unified/WA ratio on days where both feeds have data (WA undercounts vs portal). */
export function computeWaCreditUpliftRatio(args: {
  layers: OpenAiOrgEnvelopeLayers;
  periodStart: Date;
  periodEnd: Date;
}): number {
  const dailyRatios: number[] = [];
  let overlapUnifiedUsd = 0;
  let overlapWaUsd = 0;

  for (const day of enumerateDays(args.periodStart, args.periodEnd)) {
    const ymd = localYmd(day);
    const unifiedUsd =
      (args.layers.unifiedChatByYmd.get(ymd) ?? 0) + (args.layers.unifiedCodByYmd.get(ymd) ?? 0);
    const waUsd = args.layers.workspacePoolByYmd.get(ymd) ?? 0;
    if (unifiedUsd >= MIN_OVERLAP_DAY_USD && waUsd >= MIN_OVERLAP_DAY_USD) {
      dailyRatios.push(unifiedUsd / waUsd);
      overlapUnifiedUsd += unifiedUsd;
      overlapWaUsd += waUsd;
    }
  }

  if (dailyRatios.length === 0) {
    if (
      hasWaOnlyDaysInPeriod({
        layers: args.layers,
        periodStart: args.periodStart,
        periodEnd: args.periodEnd,
      })
    ) {
      return Math.min(Math.max(OPENAI_WA_PORTAL_UPLIFT_DEFAULT, 1), 1.35);
    }
    return 1;
  }

  dailyRatios.sort((a, b) => a - b);
  const median = dailyRatios[Math.floor(dailyRatios.length / 2)]!;
  const volumeWeighted = overlapWaUsd > 0 ? overlapUnifiedUsd / overlapWaUsd : median;
  const uplift = Math.max(median, volumeWeighted);
  return Math.min(Math.max(uplift, 1), 1.35);
}

/** True when at least one period day has WA pool but no unified COSTS row. */
export function hasWaOnlyDaysInPeriod(args: {
  layers: OpenAiOrgEnvelopeLayers;
  periodStart: Date;
  periodEnd: Date;
}): boolean {
  for (const day of enumerateDays(args.periodStart, args.periodEnd)) {
    const ymd = localYmd(day);
    const unifiedUsd =
      (args.layers.unifiedChatByYmd.get(ymd) ?? 0) + (args.layers.unifiedCodByYmd.get(ymd) ?? 0);
    const waUsd = args.layers.workspacePoolByYmd.get(ymd) ?? 0;
    if (waUsd >= MIN_OVERLAP_DAY_USD && unifiedUsd <= 0) return true;
  }
  return false;
}

/**
 * Scale WA-only gap days toward OpenAI Admin Credits.
 * Unified COSTS days are billing-native and are never re-uplifted.
 */
export function sumOpenAiWaCalibratedEnvelopeUsd(args: {
  merged: OpenAiDailyMergedSpend;
  layers: OpenAiOrgEnvelopeLayers;
  periodStart: Date;
  periodEnd: Date;
}): { totalUsd: number; uplift: number; usesUplift: boolean } {
  const dailyTotal = sumOpenAiPortalAlignedEnvelopeUsd(args);

  if (
    !hasWaOnlyDaysInPeriod({
      layers: args.layers,
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
    })
  ) {
    return { totalUsd: dailyTotal, uplift: 1, usesUplift: false };
  }

  const uplift = computeWaCreditUpliftRatio(args);
  if (uplift <= 1.005) {
    return { totalUsd: dailyTotal, uplift: 1, usesUplift: false };
  }

  let totalUsd = 0;
  for (const day of enumerateDays(args.periodStart, args.periodEnd)) {
    const ymd = localYmd(day);
    const unifiedUsd =
      (args.layers.unifiedChatByYmd.get(ymd) ?? 0) + (args.layers.unifiedCodByYmd.get(ymd) ?? 0);
    if (unifiedUsd > 0) {
      totalUsd += unifiedUsd;
      continue;
    }

    const waPoolUsd = args.layers.workspacePoolByYmd.get(ymd) ?? 0;
    if (waPoolUsd > 0) {
      totalUsd += waPoolUsd * uplift;
      continue;
    }

    const orgCostsUsd =
      (args.layers.orgCostsChatByYmd.get(ymd) ?? 0) + (args.layers.orgCostsCodByYmd.get(ymd) ?? 0);
    if (orgCostsUsd > 0) {
      totalUsd += orgCostsUsd;
      continue;
    }

    totalUsd +=
      (args.merged.chatgpt.byYmd.get(ymd) ?? 0) + (args.merged.codex.byYmd.get(ymd) ?? 0);
  }

  return {
    totalUsd,
    uplift,
    usesUplift: true,
  };
}

/** Per-day org envelope USD using billing-aligned source priority. */
export function sumOpenAiPortalAlignedEnvelopeUsd(args: {
  merged: OpenAiDailyMergedSpend;
  layers: OpenAiOrgEnvelopeLayers;
  periodStart: Date;
  periodEnd: Date;
}): number {
  let totalUsd = 0;

  for (const day of enumerateDays(args.periodStart, args.periodEnd)) {
    const ymd = localYmd(day);
    const unifiedUsd =
      (args.layers.unifiedChatByYmd.get(ymd) ?? 0) + (args.layers.unifiedCodByYmd.get(ymd) ?? 0);
    if (unifiedUsd > 0) {
      totalUsd += unifiedUsd;
      continue;
    }

    const orgCostsUsd =
      (args.layers.orgCostsChatByYmd.get(ymd) ?? 0) + (args.layers.orgCostsCodByYmd.get(ymd) ?? 0);
    if (orgCostsUsd > 0) {
      totalUsd += orgCostsUsd;
      continue;
    }

    const waPoolUsd = args.layers.workspacePoolByYmd.get(ymd) ?? 0;
    if (waPoolUsd > 0) {
      totalUsd += waPoolUsd;
      continue;
    }

    const chatgptUsd = args.merged.chatgpt.byYmd.get(ymd) ?? 0;
    const codexUsd = args.merged.codex.byYmd.get(ymd) ?? 0;
    totalUsd += chatgptUsd + codexUsd;
  }

  return totalUsd;
}

export type OpenAiEnvelopeSource = "workspace_analytics" | "unified_credits" | "org_costs" | "mixed";

/** Which layer dominates the portal-aligned envelope for the period. */
export function dominantOpenAiEnvelopeSource(layers: OpenAiOrgEnvelopeLayers): OpenAiEnvelopeSource {
  const unified =
    sumMap(layers.unifiedChatByYmd) + sumMap(layers.unifiedCodByYmd);
  const orgCosts =
    sumMap(layers.orgCostsChatByYmd) + sumMap(layers.orgCostsCodByYmd);
  const wa = sumMap(layers.workspacePoolByYmd);

  const best = Math.max(unified, orgCosts, wa);
  if (best <= 0) return "mixed";
  if (best === unified) return "unified_credits";
  if (best === orgCosts) return "org_costs";
  return "workspace_analytics";
}

function sumMap(m: Map<string, number>): number {
  let s = 0;
  for (const v of m.values()) s += v;
  return s;
}

export type OpenAiPortalEnvelopeResolution = {
  envelopeUsd: number;
  chatgptUsd: number;
  codexUsd: number;
  source: OpenAiEnvelopeSource;
};

/** Overlay live Unified Credits COSTS (credit-native) onto mirror layers. */
export function mergeLiveUnifiedIntoEnvelopeLayers(
  layers: OpenAiOrgEnvelopeLayers,
  live: { unifiedChatByYmd: Map<string, number>; unifiedCodByYmd: Map<string, number> } | null,
): OpenAiOrgEnvelopeLayers {
  if (!live) return layers;

  const unifiedChatByYmd = new Map(layers.unifiedChatByYmd);
  const unifiedCodByYmd = new Map(layers.unifiedCodByYmd);

  for (const [ymd, usd] of live.unifiedChatByYmd) {
    unifiedChatByYmd.set(ymd, Math.max(unifiedChatByYmd.get(ymd) ?? 0, usd));
  }
  for (const [ymd, usd] of live.unifiedCodByYmd) {
    unifiedCodByYmd.set(ymd, Math.max(unifiedCodByYmd.get(ymd) ?? 0, usd));
  }

  return { ...layers, unifiedChatByYmd, unifiedCodByYmd };
}

/** Pick the highest-fidelity org envelope for the period (matches OpenAI Admin Credits). */
export function resolveOpenAiPortalEnvelope(args: {
  merged: OpenAiDailyMergedSpend;
  layers: OpenAiOrgEnvelopeLayers;
  periodStart: Date;
  periodEnd: Date;
  liveOrgCosts?: { chatgptUsd: number; codexUsd: number; totalUsd: number } | null;
}): OpenAiPortalEnvelopeResolution {
  const unifiedChat = sumProductMapsInPeriod({
    chatByYmd: args.layers.unifiedChatByYmd,
    codByYmd: new Map(),
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
  });
  const unifiedCod = sumProductMapsInPeriod({
    chatByYmd: new Map(),
    codByYmd: args.layers.unifiedCodByYmd,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
  });
  const unifiedTotal = unifiedChat + unifiedCod;

  const mirrorOrgChat = sumMapInPeriod(
    args.layers.orgCostsChatByYmd,
    args.periodStart,
    args.periodEnd,
  );
  const mirrorOrgCod = sumMapInPeriod(
    args.layers.orgCostsCodByYmd,
    args.periodStart,
    args.periodEnd,
  );
  const mirrorOrgTotal = mirrorOrgChat + mirrorOrgCod;

  const liveOrg = args.liveOrgCosts;
  const orgChat = Math.max(mirrorOrgChat, liveOrg?.chatgptUsd ?? 0);
  const orgCod = Math.max(mirrorOrgCod, liveOrg?.codexUsd ?? 0);
  const orgTotal = Math.max(mirrorOrgTotal, liveOrg?.totalUsd ?? 0, orgChat + orgCod);

  const waTotal = sumMapInPeriod(
    args.layers.workspacePoolByYmd,
    args.periodStart,
    args.periodEnd,
  );
  const dailyTotal = sumOpenAiPortalAlignedEnvelopeUsd({
    merged: args.merged,
    layers: args.layers,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
  });
  const calibrated = sumOpenAiWaCalibratedEnvelopeUsd({
    merged: args.merged,
    layers: args.layers,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
  });

  type Candidate = OpenAiPortalEnvelopeResolution;
  const candidates: Candidate[] = [
    {
      envelopeUsd: unifiedTotal,
      chatgptUsd: unifiedChat,
      codexUsd: unifiedCod,
      source: "unified_credits" as const,
    },
  ];

  if (
    calibrated.usesUplift &&
    hasWaOnlyDaysInPeriod({
      layers: args.layers,
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
    }) &&
    calibrated.totalUsd > unifiedTotal + 0.01
  ) {
    candidates.push({
      envelopeUsd: calibrated.totalUsd,
      chatgptUsd: unifiedChat,
      codexUsd: unifiedCod,
      source: "unified_credits" as const,
    });
  }

  candidates.push(
    { envelopeUsd: orgTotal, chatgptUsd: orgChat, codexUsd: orgCod, source: "org_costs" as const },
    { envelopeUsd: dailyTotal, chatgptUsd: 0, codexUsd: 0, source: "mixed" as const },
    { envelopeUsd: waTotal, chatgptUsd: waTotal, codexUsd: 0, source: "workspace_analytics" as const },
  );

  const filtered = candidates.filter((c) => c.envelopeUsd > 0);

  if (filtered.length === 0) {
    return { envelopeUsd: 0, chatgptUsd: 0, codexUsd: 0, source: "mixed" };
  }

  const priority: OpenAiEnvelopeSource[] = [
    "unified_credits",
    "org_costs",
    "mixed",
    "workspace_analytics",
  ];

  let best = filtered[0]!;
  for (const c of filtered.slice(1)) {
    if (c.envelopeUsd > best.envelopeUsd + 0.01) {
      best = c;
      continue;
    }
    if (Math.abs(c.envelopeUsd - best.envelopeUsd) <= 0.01) {
      if (priority.indexOf(c.source) < priority.indexOf(best.source)) best = c;
    }
  }

  return best;
}
