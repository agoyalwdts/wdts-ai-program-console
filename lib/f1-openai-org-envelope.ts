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
import { UNIFIED_CREDITS_VENDOR_KEY } from "@/lib/integrations/unified-credits/constants";
import { WORKSPACE_ANALYTICS_USER_VENDOR_KEY } from "@/lib/integrations/workspace-analytics/vendor-key";

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
  const [unifiedChatByYmd, unifiedCodByYmd, orgCostsChatByYmd, orgCostsCodByYmd, workspacePoolByYmd] =
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
    ]);

  return {
    unifiedChatByYmd,
    unifiedCodByYmd,
    orgCostsChatByYmd,
    orgCostsCodByYmd,
    workspacePoolByYmd,
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
