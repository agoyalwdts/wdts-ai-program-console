/**
 * Per-day OpenAI vendor merge for F1 — Unified Credits wins only on days it
 * exists; other days fall back to Codex Enterprise / Workspace Analytics / org costs.
 */

import { Product, type PrismaClient } from "@prisma/client";
import type { SpendPoint } from "@/components/charts/spend-trend-chart";
import { getIntegrationMode } from "@/lib/integrations/env";
import { CODEX_ENTERPRISE_ANALYTICS_VENDOR_KEY } from "@/lib/integrations/codex-enterprise-analytics/fetch-workspace-usage";
import { OPENAI_ORG_COSTS_VENDOR_KEY } from "@/lib/integrations/openai/org-costs";
import { UNIFIED_CREDITS_VENDOR_KEY } from "@/lib/integrations/unified-credits/constants";
import { WORKSPACE_ANALYTICS_USER_VENDOR_KEY } from "@/lib/integrations/workspace-analytics/vendor-key";
import { localYmd } from "@/lib/f1-cursor-vendor";
import { incompleteUnifiedDayYmds } from "@/lib/f1-openai-unified-sync";
import type { ProductKey } from "@/lib/program";
import type { OpenAiF1SpendSources } from "@/lib/f1-openai-spend";

export type OpenAiDailyProductSeries = {
  periodTotalUsd: number;
  byChartDay: Map<string, number>;
  byYmd: Map<string, number>;
  /** Winning vendor source per calendar day (YYYY-MM-DD). */
  byYmdSource: Map<string, string>;
  usedVendorMirror: boolean;
  dominantSource: OpenAiF1SpendSources["chatgpt"] | OpenAiF1SpendSources["codex"] | "gateway";
};

export type OpenAiDailyMergedSpend = {
  chatgpt: OpenAiDailyProductSeries;
  codex: OpenAiDailyProductSeries;
};

type VendorLayer = {
  source: OpenAiF1SpendSources["chatgpt"] | OpenAiF1SpendSources["codex"];
  product: Product;
  vendor: string;
  priority: number;
  mapKey: string;
};

const CHATGPT_LAYERS: VendorLayer[] = [
  {
    source: "unified_credits",
    product: Product.CHATGPT,
    vendor: UNIFIED_CREDITS_VENDOR_KEY,
    priority: 50,
    mapKey: `${UNIFIED_CREDITS_VENDOR_KEY}:CHATGPT`,
  },
  {
    source: "workspace_analytics",
    product: Product.CHATGPT,
    vendor: WORKSPACE_ANALYTICS_USER_VENDOR_KEY,
    priority: 40,
    mapKey: `${WORKSPACE_ANALYTICS_USER_VENDOR_KEY}:CHATGPT`,
  },
  {
    source: "vendor",
    product: Product.CHATGPT,
    vendor: OPENAI_ORG_COSTS_VENDOR_KEY,
    priority: 30,
    mapKey: `${OPENAI_ORG_COSTS_VENDOR_KEY}:CHATGPT`,
  },
];

const CODEX_LAYERS: VendorLayer[] = [
  {
    source: "unified_credits",
    product: Product.CODEX,
    vendor: UNIFIED_CREDITS_VENDOR_KEY,
    priority: 50,
    mapKey: `${UNIFIED_CREDITS_VENDOR_KEY}:CODEX`,
  },
  {
    source: "codex_enterprise_analytics_sync",
    product: Product.CODEX,
    vendor: CODEX_ENTERPRISE_ANALYTICS_VENDOR_KEY,
    priority: 40,
    mapKey: `${CODEX_ENTERPRISE_ANALYTICS_VENDOR_KEY}:CODEX`,
  },
  {
    source: "openai_org_costs",
    product: Product.CODEX,
    vendor: OPENAI_ORG_COSTS_VENDOR_KEY,
    priority: 30,
    mapKey: `${OPENAI_ORG_COSTS_VENDOR_KEY}:CODEX`,
  },
];

function chartDayLabel(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

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

function enumerateDays(periodStart: Date, periodEnd: Date): Date[] {
  const startDay = new Date(periodStart);
  startDay.setHours(0, 0, 0, 0);
  const endDay = new Date(periodEnd);
  endDay.setHours(0, 0, 0, 0);
  if (startDay.getTime() > endDay.getTime()) return [];

  const out: Date[] = [];
  for (let d = new Date(startDay); d.getTime() <= endDay.getTime(); d.setDate(d.getDate() + 1)) {
    out.push(new Date(d));
  }
  return out;
}

async function loadVendorUsdByYmd(
  prisma: PrismaClient,
  args: { rangeStart: Date; rangeEnd: Date; vendor: string; product: Product },
): Promise<Map<string, number>> {
  const rows = await prisma.vendorDailySpend.findMany({
    where: {
      vendor: args.vendor,
      product: args.product,
      day: { gte: args.rangeStart, lte: args.rangeEnd },
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

function mergeProductDaily(args: {
  periodStart: Date;
  periodEnd: Date;
  layers: VendorLayer[];
  layerMaps: Map<string, Map<string, number>>;
  gatewayByYmd?: Map<string, number>;
  skipUnifiedYmds?: Set<string>;
}): OpenAiDailyProductSeries {
  const days = enumerateDays(args.periodStart, args.periodEnd);
  const byYmd = new Map<string, number>();
  const byYmdSource = new Map<string, string>();
  const byChartDay = new Map<string, number>();
  const sourceTotals = new Map<string, number>();
  let periodTotalUsd = 0;
  let usedVendorMirror = false;

  for (const day of days) {
    const ymd = localYmd(day);
    let usd = args.gatewayByYmd?.get(ymd) ?? 0;
    let source: string = "gateway";

    for (const layer of [...args.layers].sort((a, b) => b.priority - a.priority)) {
      if (layer.source === "unified_credits" && args.skipUnifiedYmds?.has(ymd)) continue;
      const layerUsd = args.layerMaps.get(layer.mapKey)?.get(ymd) ?? 0;
      if (layerUsd > 0) {
        usd = layerUsd;
        source = layer.source;
        usedVendorMirror = true;
        break;
      }
    }

    byYmd.set(ymd, usd);
    byYmdSource.set(ymd, source);
    byChartDay.set(chartDayLabel(day), usd);
    periodTotalUsd += usd;
    sourceTotals.set(source, (sourceTotals.get(source) ?? 0) + usd);
  }

  let dominantSource: OpenAiDailyProductSeries["dominantSource"] = "gateway";
  let best = 0;
  for (const [source, total] of sourceTotals) {
    if (total > best) {
      best = total;
      dominantSource = source as OpenAiDailyProductSeries["dominantSource"];
    }
  }

  return { periodTotalUsd, byChartDay, byYmd, byYmdSource, usedVendorMirror, dominantSource };
}

export async function loadOpenAiDailyMergedSpendForF1(
  prisma: PrismaClient,
  args: {
    periodStart: Date;
    periodEnd: Date;
    gatewayChatgptByYmd?: Map<string, number>;
    gatewayCodexByYmd?: Map<string, number>;
    env?: Record<string, string | undefined>;
  },
): Promise<OpenAiDailyMergedSpend> {
  const empty: OpenAiDailyProductSeries = {
    periodTotalUsd: 0,
    byChartDay: new Map(),
    byYmd: new Map(),
    byYmdSource: new Map(),
    usedVendorMirror: false,
    dominantSource: "gateway",
  };

  if (enumerateDays(args.periodStart, args.periodEnd).length === 0) {
    return { chatgpt: empty, codex: empty };
  }

  const env = args.env ?? process.env;
  const { rangeStart, rangeEnd } = vendorDayRange(args.periodStart, args.periodEnd);

  const enabledLayers = {
    openaiOrg: getIntegrationMode("openai", env) === "real",
    codexEnterprise: getIntegrationMode("codexenterprise", env) === "real",
    workspace: getIntegrationMode("openaicompliance", env) === "real",
    unified: getIntegrationMode("openaicompliance", env) === "real",
  };

  const layerMaps = new Map<string, Map<string, number>>();
  const loads: Promise<void>[] = [];

  for (const layer of [...CHATGPT_LAYERS, ...CODEX_LAYERS]) {
    if (layer.vendor === OPENAI_ORG_COSTS_VENDOR_KEY && !enabledLayers.openaiOrg) continue;
    if (layer.vendor === CODEX_ENTERPRISE_ANALYTICS_VENDOR_KEY && !enabledLayers.codexEnterprise) {
      continue;
    }
    if (layer.vendor === WORKSPACE_ANALYTICS_USER_VENDOR_KEY && !enabledLayers.workspace) continue;
    if (layer.vendor === UNIFIED_CREDITS_VENDOR_KEY && !enabledLayers.unified) continue;

    loads.push(
      loadVendorUsdByYmd(prisma, {
        rangeStart,
        rangeEnd,
        vendor: layer.vendor,
        product: layer.product,
      }).then((map) => {
        layerMaps.set(layer.mapKey, map);
      }),
    );
  }

  await Promise.all(loads);

  const unifiedChat =
    layerMaps.get(`${UNIFIED_CREDITS_VENDOR_KEY}:${Product.CHATGPT}`) ?? new Map<string, number>();
  const unifiedCod =
    layerMaps.get(`${UNIFIED_CREDITS_VENDOR_KEY}:${Product.CODEX}`) ?? new Map<string, number>();
  const workspacePool =
    layerMaps.get(`${WORKSPACE_ANALYTICS_USER_VENDOR_KEY}:${Product.CHATGPT}`) ??
    new Map<string, number>();
  const skipUnifiedYmds = incompleteUnifiedDayYmds({
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    unifiedChatByYmd: unifiedChat,
    unifiedCodByYmd: unifiedCod,
    workspacePoolByYmd: workspacePool,
  });

  return {
    chatgpt: mergeProductDaily({
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      layers: CHATGPT_LAYERS,
      layerMaps,
      gatewayByYmd: args.gatewayChatgptByYmd,
      skipUnifiedYmds,
    }),
    codex: mergeProductDaily({
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      layers: CODEX_LAYERS,
      layerMaps,
      gatewayByYmd: args.gatewayCodexByYmd,
      skipUnifiedYmds,
    }),
  };
}

export function applyOpenAiDailyMergedSpendToF1(args: {
  mtdMap: Map<ProductKey, number>;
  days: SpendPoint[];
  merged: OpenAiDailyMergedSpend;
}): void {
  if (args.merged.chatgpt.usedVendorMirror || args.merged.chatgpt.periodTotalUsd > 0) {
    args.mtdMap.set("CHATGPT", args.merged.chatgpt.periodTotalUsd);
  }
  if (args.merged.codex.usedVendorMirror || args.merged.codex.periodTotalUsd > 0) {
    args.mtdMap.set("CODEX", args.merged.codex.periodTotalUsd);
  }
  for (const row of args.days) {
    const chatgptUsd = args.merged.chatgpt.byChartDay.get(row.day);
    if (chatgptUsd != null) row.CHATGPT = chatgptUsd;
    const codexUsd = args.merged.codex.byChartDay.get(row.day);
    if (codexUsd != null) row.CODEX = codexUsd;
  }
}

export function openAiSourcesFromDailyMerge(merged: OpenAiDailyMergedSpend): OpenAiF1SpendSources {
  return {
    chatgpt:
      merged.chatgpt.dominantSource === "gateway"
        ? "gateway"
        : (merged.chatgpt.dominantSource as OpenAiF1SpendSources["chatgpt"]),
    codex:
      merged.codex.dominantSource === "gateway"
        ? "gateway"
        : merged.codex.dominantSource === "codex_enterprise_analytics_sync"
          ? "codex_enterprise_analytics_sync"
          : (merged.codex.dominantSource as OpenAiF1SpendSources["codex"]),
  };
}
