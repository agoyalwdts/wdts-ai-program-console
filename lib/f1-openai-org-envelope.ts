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
import {
  isIncompleteUnifiedDaySync,
  medianCompleteUnifiedDayUsd,
  MIN_UNIFIED_COMPLETE_DAY_USD,
} from "@/lib/f1-openai-unified-sync";

export { isIncompleteUnifiedDaySync } from "@/lib/f1-openai-unified-sync";

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

/**
 * Merge VendorDailySpend with snapshot Unified COSTS rows.
 * Mid-sync vendor upserts can be a sliver while snapshots already hold more of
 * the day — take the larger total so partial cron rows do not hide fuller data.
 */
export function preferVendorUnifiedUsdByYmd(
  vendor: Map<string, number>,
  snapshot: Map<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const ymd of new Set([...vendor.keys(), ...snapshot.keys()])) {
    const vendorUsd = vendor.get(ymd) ?? 0;
    const snapshotUsd = snapshot.get(ymd) ?? 0;
    out.set(ymd, Math.max(vendorUsd, snapshotUsd));
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

/** Codex share (0–1) from complete Unified COSTS days in the period. */
export function volumeWeightedUnifiedCodShare(args: {
  layers: OpenAiOrgEnvelopeLayers;
  periodStart: Date;
  periodEnd: Date;
}): number {
  let chatUsd = 0;
  let codUsd = 0;
  const medianLoose = medianCompleteUnifiedDayUsd({
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    unifiedChatByYmd: args.layers.unifiedChatByYmd,
    unifiedCodByYmd: args.layers.unifiedCodByYmd,
    workspacePoolByYmd: args.layers.workspacePoolByYmd,
  });

  for (const day of enumerateDays(args.periodStart, args.periodEnd)) {
    const ymd = localYmd(day);
    const uChat = args.layers.unifiedChatByYmd.get(ymd) ?? 0;
    const uCod = args.layers.unifiedCodByYmd.get(ymd) ?? 0;
    const unifiedDay = uChat + uCod;
    const waPoolUsd = args.layers.workspacePoolByYmd.get(ymd) ?? 0;
    const medianExcludingDay = medianCompleteUnifiedDayUsd({
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      unifiedChatByYmd: args.layers.unifiedChatByYmd,
      unifiedCodByYmd: args.layers.unifiedCodByYmd,
      workspacePoolByYmd: args.layers.workspacePoolByYmd,
      excludeYmd: ymd,
    });
    if (
      unifiedDay > 0 &&
      !isIncompleteUnifiedDaySync(unifiedDay, waPoolUsd, medianExcludingDay || medianLoose)
    ) {
      chatUsd += uChat;
      codUsd += uCod;
    }
  }

  const total = chatUsd + codUsd;
  if (total <= 0) return 0.65;
  return codUsd / total;
}

/** Split a daily envelope USD using Unified COSTS ratios (not lagging Codex EA). */
export function splitPortalEnvelopeDayUsd(args: {
  dayUsd: number;
  uChat: number;
  uCod: number;
  periodCodShare: number;
  /** When set, trust EA only if it covers most of the billing-aligned cod slice. */
  dayCodexEaUsd?: number;
}): { chatgptUsd: number; codexUsd: number } {
  const unifiedTotal = args.uChat + args.uCod;
  const codShare = unifiedTotal > 0 ? args.uCod / unifiedTotal : args.periodCodShare;
  const expectedCodUsd = args.dayUsd * codShare;

  if (args.dayCodexEaUsd != null && args.dayCodexEaUsd > 0) {
    if (args.dayCodexEaUsd >= expectedCodUsd * 0.75) {
      const codSlice = Math.min(args.dayUsd, args.dayCodexEaUsd);
      return {
        codexUsd: codSlice,
        chatgptUsd: Math.max(0, args.dayUsd - codSlice),
      };
    }
  }

  return {
    codexUsd: expectedCodUsd,
    chatgptUsd: args.dayUsd - expectedCodUsd,
  };
}

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
    unifiedChatByYmd: preferVendorUnifiedUsdByYmd(
      unifiedChatVendor,
      snapshotUnified.unifiedChatByYmd,
    ),
    unifiedCodByYmd: preferVendorUnifiedUsdByYmd(unifiedCodVendor, snapshotUnified.unifiedCodByYmd),
    orgCostsChatByYmd,
    orgCostsCodByYmd,
    workspacePoolByYmd,
  };
}

/** @deprecated alias — use MIN_UNIFIED_COMPLETE_DAY_USD */
const MIN_OVERLAP_DAY_USD = MIN_UNIFIED_COMPLETE_DAY_USD;

/**
 * Fallback WA→portal uplift when unified and WA cover disjoint day ranges (no overlap
 * to measure). Derived from observed 504K WA vs 590K Admin Credits (Jun 2026).
 */
export const OPENAI_WA_PORTAL_UPLIFT_DEFAULT = 589_900 / 504_908;

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
  const medianLoose = medianCompleteUnifiedDayUsd({
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    unifiedChatByYmd: args.layers.unifiedChatByYmd,
    unifiedCodByYmd: args.layers.unifiedCodByYmd,
    workspacePoolByYmd: args.layers.workspacePoolByYmd,
  });

  for (const day of enumerateDays(args.periodStart, args.periodEnd)) {
    const ymd = localYmd(day);
    const unifiedUsd =
      (args.layers.unifiedChatByYmd.get(ymd) ?? 0) + (args.layers.unifiedCodByYmd.get(ymd) ?? 0);
    const waUsd = args.layers.workspacePoolByYmd.get(ymd) ?? 0;
    if (
      unifiedUsd >= MIN_OVERLAP_DAY_USD &&
      waUsd >= MIN_OVERLAP_DAY_USD &&
      !isIncompleteUnifiedDaySync(unifiedUsd, waUsd, medianLoose)
    ) {
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
    const medianExcludingDay = medianCompleteUnifiedDayUsd({
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      unifiedChatByYmd: args.layers.unifiedChatByYmd,
      unifiedCodByYmd: args.layers.unifiedCodByYmd,
      workspacePoolByYmd: args.layers.workspacePoolByYmd,
      excludeYmd: ymd,
    });
    if (
      waUsd >= MIN_OVERLAP_DAY_USD &&
      (unifiedUsd <= 0 ||
        isIncompleteUnifiedDaySync(unifiedUsd, waUsd, medianExcludingDay))
    ) {
      return true;
    }
  }
  return false;
}

/** Per-day org envelope USD using billing-aligned source priority. */
export function sumOpenAiPortalAlignedEnvelopeUsd(args: {
  merged: OpenAiDailyMergedSpend;
  layers: OpenAiOrgEnvelopeLayers;
  periodStart: Date;
  periodEnd: Date;
}): number {
  return sumPortalEnvelopeProductUsd(args).totalUsd;
}

export type PortalEnvelopeProductSum = {
  chatgptUsd: number;
  codexUsd: number;
  totalUsd: number;
  /** USD from Unified Credits COSTS layers (billing-native). */
  unifiedUsd: number;
};

/**
 * Portal-aligned org envelope with explicit ChatGPT / Codex split.
 * Unified days use COSTS product slices; WA-only gap days use pool − Codex EA.
 */
export function sumPortalEnvelopeProductUsd(args: {
  merged: OpenAiDailyMergedSpend;
  layers: OpenAiOrgEnvelopeLayers;
  periodStart: Date;
  periodEnd: Date;
  /** When > 1, scale WA-only gap days (Unified days are never re-uplifted). */
  waGapUplift?: number;
}): PortalEnvelopeProductSum {
  const uplift = args.waGapUplift ?? 1;
  const periodCodShare = volumeWeightedUnifiedCodShare({
    layers: args.layers,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
  });
  let chatgptUsd = 0;
  let codexUsd = 0;
  let unifiedUsd = 0;

  for (const day of enumerateDays(args.periodStart, args.periodEnd)) {
    const ymd = localYmd(day);
    const uChat = args.layers.unifiedChatByYmd.get(ymd) ?? 0;
    const uCod = args.layers.unifiedCodByYmd.get(ymd) ?? 0;
    const unifiedDay = uChat + uCod;
    const waPoolUsd = args.layers.workspacePoolByYmd.get(ymd) ?? 0;
    const medianExcludingDay = medianCompleteUnifiedDayUsd({
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      unifiedChatByYmd: args.layers.unifiedChatByYmd,
      unifiedCodByYmd: args.layers.unifiedCodByYmd,
      workspacePoolByYmd: args.layers.workspacePoolByYmd,
      excludeYmd: ymd,
    });
    const useUnified =
      unifiedDay > 0 &&
      !isIncompleteUnifiedDaySync(unifiedDay, waPoolUsd, medianExcludingDay);
    if (useUnified) {
      chatgptUsd += uChat;
      codexUsd += uCod;
      unifiedUsd += unifiedDay;
      continue;
    }

    const oChat = args.layers.orgCostsChatByYmd.get(ymd) ?? 0;
    const oCod = args.layers.orgCostsCodByYmd.get(ymd) ?? 0;
    if (oChat + oCod > 0) {
      chatgptUsd += oChat;
      codexUsd += oCod;
      continue;
    }

    const incompleteUnified =
      unifiedDay > 0 && isIncompleteUnifiedDaySync(unifiedDay, waPoolUsd, medianExcludingDay);
    if (incompleteUnified) {
      const projectedUsd = medianExcludingDay;
      const waEstimate = waPoolUsd > 0 ? waPoolUsd * uplift : 0;
      // Prefer in-period median for mid-sync unified rows. WA can show a full-day
      // pool while Unified COSTS is still catching up — never let WA×uplift exceed
      // median when a complete-day baseline exists.
      //
      // When every day in the window is incomplete (e.g. early-month MTD with only
      // partial Unified mirrors), median is 0 — fall through to WA×uplift like the
      // daily merge skip path, instead of summing mid-sync slivers (~10K vs ~238K).
      let dayUsd = 0;
      if (projectedUsd >= MIN_UNIFIED_COMPLETE_DAY_USD) {
        dayUsd = projectedUsd;
        if (waEstimate > unifiedDay && waEstimate < projectedUsd) {
          dayUsd = waEstimate;
        }
      } else if (waEstimate > unifiedDay) {
        dayUsd = waEstimate;
      }
      if (dayUsd > unifiedDay + 0.01) {
        const split = splitPortalEnvelopeDayUsd({
          dayUsd,
          uChat,
          uCod,
          periodCodShare,
          dayCodexEaUsd: projectedUsd < MIN_UNIFIED_COMPLETE_DAY_USD
            ? args.merged.codex.byYmd.get(ymd)
            : undefined,
        });
        chatgptUsd += split.chatgptUsd;
        codexUsd += split.codexUsd;
        continue;
      }
      chatgptUsd += uChat;
      codexUsd += uCod;
      continue;
    }

    if (waPoolUsd > 0) {
      const poolUsd = waPoolUsd * uplift;
      const dayCodexUsd = args.merged.codex.byYmd.get(ymd) ?? 0;
      const split = splitPortalEnvelopeDayUsd({
        dayUsd: poolUsd,
        uChat,
        uCod,
        periodCodShare,
        dayCodexEaUsd: dayCodexUsd,
      });
      chatgptUsd += split.chatgptUsd;
      codexUsd += split.codexUsd;
      continue;
    }

    chatgptUsd += args.merged.chatgpt.byYmd.get(ymd) ?? 0;
    codexUsd += args.merged.codex.byYmd.get(ymd) ?? 0;
  }

  return { chatgptUsd, codexUsd, totalUsd: chatgptUsd + codexUsd, unifiedUsd };
}

/** @deprecated Use sumPortalEnvelopeProductUsd — kept for tests importing the name. */
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

  const calibrated = sumPortalEnvelopeProductUsd({ ...args, waGapUplift: uplift });
  return {
    totalUsd: calibrated.totalUsd,
    uplift,
    usesUplift: true,
  };
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

/** Pick the billing-aligned org envelope for the period (matches OpenAI Admin Credits). */
export function resolveOpenAiPortalEnvelope(args: {
  merged: OpenAiDailyMergedSpend;
  layers: OpenAiOrgEnvelopeLayers;
  periodStart: Date;
  periodEnd: Date;
  liveOrgCosts?: { chatgptUsd: number; codexUsd: number; totalUsd: number } | null;
}): OpenAiPortalEnvelopeResolution {
  const aligned = sumPortalEnvelopeProductUsd(args);
  const waOnlyGaps = hasWaOnlyDaysInPeriod({
    layers: args.layers,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
  });
  const uplift = computeWaCreditUpliftRatio(args);

  let product = aligned;
  const usedGapCalibration =
    waOnlyGaps &&
    uplift > 1.005 &&
    (() => {
      const calibrated = sumPortalEnvelopeProductUsd({ ...args, waGapUplift: uplift });
      if (calibrated.totalUsd > aligned.totalUsd + 0.01) {
        product = calibrated;
        return true;
      }
      return false;
    })();

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
  const liveOrg = args.liveOrgCosts;
  const orgTotal = Math.max(
    mirrorOrgChat + mirrorOrgCod,
    liveOrg?.totalUsd ?? 0,
    (liveOrg?.chatgptUsd ?? 0) + (liveOrg?.codexUsd ?? 0),
  );

  let source: OpenAiEnvelopeSource = "mixed";
  if (aligned.unifiedUsd > 0) {
    source = "unified_credits";
  } else if (orgTotal > product.totalUsd + 0.01) {
    source = "org_costs";
    const orgChat = Math.max(mirrorOrgChat, liveOrg?.chatgptUsd ?? 0);
    const orgCod = Math.max(mirrorOrgCod, liveOrg?.codexUsd ?? 0);
    product = {
      chatgptUsd: orgChat,
      codexUsd: orgCod,
      totalUsd: orgTotal,
      unifiedUsd: 0,
    };
  } else if (usedGapCalibration) {
    source = "unified_credits";
  } else if (orgTotal >= product.totalUsd * 0.5 && orgTotal > 0) {
    source = "org_costs";
  } else if (
    sumMapInPeriod(args.layers.workspacePoolByYmd, args.periodStart, args.periodEnd) >=
    product.totalUsd * 0.5
  ) {
    source = "workspace_analytics";
  }

  return {
    envelopeUsd: product.totalUsd,
    chatgptUsd: product.chatgptUsd,
    codexUsd: product.codexUsd,
    source,
  };
}
