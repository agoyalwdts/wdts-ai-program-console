/**
 * Load ChatGPT + Codex spend for a single F1 date window (gateway + vendor layers).
 */

import { Product } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { SpendPoint } from "@/components/charts/spend-trend-chart";
import { getGatewayClient } from "@/lib/integrations";
import {
  applyOpenAiDailyMergedSpendToF1,
  loadOpenAiDailyMergedSpendForF1,
  openAiSourcesFromDailyMerge,
} from "@/lib/f1-openai-daily-spend";
import {
  loadManualVendorExportSpendForF1,
  mergeManualVendorExportIntoF1,
} from "@/lib/f1-manual-vendor-export";
import type { ProductKey } from "@/lib/program";
import { resolveOpenAiF1Credits, resolveOpenAiF1CreditsFromMerged, type OpenAiF1Credits } from "@/lib/f1-openai-credits";
import { OPENAI_CREDIT_OVERAGE_USD } from "@/lib/program";
import { resolveUsdPerCredit } from "@/lib/integrations/codex-enterprise-analytics/fetch-workspace-usage";

export type OpenAiF1SpendSources = {
  chatgpt: "gateway" | "vendor" | "manual_export" | "workspace_analytics" | "unified_credits";
  codex:
    | "gateway"
    | "openai_org_costs"
    | "codex_enterprise_analytics_live"
    | "codex_enterprise_analytics_sync"
    | "manual_export"
    | "unified_credits";
};

export type OpenAiF1SpendSnapshot = {
  chatgptUsd: number;
  codexUsd: number;
  combinedUsd: number;
  credits: OpenAiF1Credits;
  sources: OpenAiF1SpendSources;
};

function gatewayProductMapsFromSpendPoints(args: {
  periodStart: Date;
  periodEnd: Date;
  days: SpendPoint[];
}): { chatgpt: Map<string, number>; codex: Map<string, number> } {
  const chatgpt = new Map<string, number>();
  const codex = new Map<string, number>();
  const startDay = new Date(args.periodStart);
  startDay.setHours(0, 0, 0, 0);
  const endDay = new Date(args.periodEnd);
  endDay.setHours(0, 0, 0, 0);

  for (let d = new Date(startDay); d.getTime() <= endDay.getTime(); d.setDate(d.getDate() + 1)) {
    const label = `${d.getMonth() + 1}/${d.getDate()}`;
    const row = args.days.find((r) => r.day === label);
    if (!row) continue;
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    chatgpt.set(ymd, row.CHATGPT);
    codex.set(ymd, row.CODEX);
  }

  return { chatgpt, codex };
}

/** Totals only — for the OpenAI card, per-product tiles, and leaderboard. */
export async function loadOpenAiSpendSnapshotForF1(
  prisma: PrismaClient,
  args: { periodStart: Date; periodEnd: Date; budgetMonthMultiplier?: number },
): Promise<OpenAiF1SpendSnapshot> {
  const gateway = getGatewayClient();
  const [programAgg, merged, vendorManualExport] = await Promise.all([
    gateway.aggregateByProgram({ periodStart: args.periodStart, periodEnd: args.periodEnd }),
    loadOpenAiDailyMergedSpendForF1(prisma, args),
    loadManualVendorExportSpendForF1(prisma, args),
  ]);

  const mtdMap = new Map<ProductKey, number>(
    programAgg
      .filter((r) => r.product === Product.CHATGPT || r.product === Product.CODEX)
      .map((r) => [r.product as ProductKey, r.totalUsd]),
  );

  applyOpenAiDailyMergedSpendToF1({ mtdMap, days: [], merged });
  mergeManualVendorExportIntoF1({
    mtdMap,
    days: [],
    chatgpt: vendorManualExport.chatgpt,
    codex: vendorManualExport.codex,
  });

  const chatgptUsd = mtdMap.get("CHATGPT") ?? 0;
  const codexUsd = mtdMap.get("CODEX") ?? 0;

  let sources = openAiSourcesFromDailyMerge(merged);
  if (vendorManualExport.chatgpt.used) sources = { ...sources, chatgpt: "manual_export" };
  if (vendorManualExport.codex.used) sources = { ...sources, codex: "manual_export" };

  const vendorMirrorCompositeUsed =
    merged.chatgpt.usedVendorMirror ||
    merged.codex.usedVendorMirror ||
    vendorManualExport.chatgpt.used ||
    vendorManualExport.codex.used;

  let credits: OpenAiF1Credits;
  if (vendorMirrorCompositeUsed) {
    credits = resolveOpenAiF1CreditsFromMerged({
      merged,
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      manualChatgptUsd: vendorManualExport.chatgpt.used
        ? vendorManualExport.chatgpt.periodTotalUsd
        : undefined,
    });
  } else {
    credits = resolveOpenAiF1Credits({
      chatgptUsd,
      codexUsd,
      budgetMonthMultiplier: args.budgetMonthMultiplier ?? 1,
      workspaceChatgptUsed: merged.chatgpt.dominantSource === "workspace_analytics",
      workspaceChatgptUsd: merged.chatgpt.periodTotalUsd,
      manualChatgptUsed: vendorManualExport.chatgpt.used,
      manualChatgptUsd: vendorManualExport.chatgpt.periodTotalUsd,
      codexEnterpriseUsed: merged.codex.dominantSource === "codex_enterprise_analytics_sync",
      codexEnterpriseUsd: merged.codex.periodTotalUsd,
      unifiedChatgptUsed: [...merged.chatgpt.byYmdSource.values()].some(
        (s) => s === "unified_credits",
      ),
      unifiedChatgptUsd: merged.chatgpt.periodTotalUsd,
      unifiedCodexUsed: [...merged.codex.byYmdSource.values()].some((s) => s === "unified_credits"),
      unifiedCodexUsd: merged.codex.periodTotalUsd,
    });
  }

  const codexUsdPerCredit = resolveUsdPerCredit();
  const displayChatgptUsd = credits.chatgptCredits * OPENAI_CREDIT_OVERAGE_USD;
  const displayCodexUsd = credits.codexCredits * codexUsdPerCredit;
  const displayCombinedUsd =
    credits.mode === "direct" && vendorMirrorCompositeUsed
      ? credits.combinedCredits * OPENAI_CREDIT_OVERAGE_USD
      : chatgptUsd + codexUsd;

  return {
    chatgptUsd: displayChatgptUsd,
    codexUsd: displayCodexUsd,
    combinedUsd: displayCombinedUsd,
    credits,
    sources,
  };
}

/** Merge OpenAI vendor layers into the page-period chart + program totals map. */
export async function mergeOpenAiSpendIntoPagePeriodF1(
  prisma: PrismaClient,
  args: {
    periodStart: Date;
    periodEnd: Date;
    mtdMap: Map<ProductKey, number>;
    days: SpendPoint[];
  },
): Promise<void> {
  const gatewayMaps = gatewayProductMapsFromSpendPoints(args);
  const [merged, vendorManualExport] = await Promise.all([
    loadOpenAiDailyMergedSpendForF1(prisma, {
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      gatewayChatgptByYmd: gatewayMaps.chatgpt,
      gatewayCodexByYmd: gatewayMaps.codex,
    }),
    loadManualVendorExportSpendForF1(prisma, args),
  ]);

  applyOpenAiDailyMergedSpendToF1({
    mtdMap: args.mtdMap,
    days: args.days,
    merged,
  });
  mergeManualVendorExportIntoF1({
    mtdMap: args.mtdMap,
    days: args.days,
    chatgpt: vendorManualExport.chatgpt,
    codex: vendorManualExport.codex,
  });
}
