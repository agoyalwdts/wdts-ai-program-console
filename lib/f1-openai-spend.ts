/**
 * Load ChatGPT + Codex spend for a single F1 date window (gateway + vendor layers).
 */

import { Product } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { SpendPoint } from "@/components/charts/spend-trend-chart";
import { getGatewayClient } from "@/lib/integrations";
import {
  loadCodexEnterpriseSpendForF1,
  mergeCodexEnterpriseVendorIntoF1,
} from "@/lib/f1-codex-enterprise-analytics";
import {
  loadChatGptWorkspaceAnalyticsSpendForF1,
  mergeChatGptWorkspaceAnalyticsIntoF1,
} from "@/lib/f1-chatgpt-workspace-analytics";
import {
  loadManualVendorExportSpendForF1,
  mergeManualVendorExportIntoF1,
} from "@/lib/f1-manual-vendor-export";
import {
  loadUnifiedCreditsSpendForF1,
  mergeUnifiedCreditsChatGptIntoF1,
  mergeUnifiedCreditsCodexIntoF1,
} from "@/lib/f1-unified-credits-spend";
import { loadOpenAiVendorSpendForF1, mergeOpenAiVendorIntoF1 } from "@/lib/f1-openai-vendor";
import type { ProductKey } from "@/lib/program";
import { resolveOpenAiF1Credits, type OpenAiF1Credits } from "@/lib/f1-openai-credits";

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

function resolveOpenAiSources(args: {
  manualChatgptUsed: boolean;
  workspaceAnalyticsChatgptUsed: boolean;
  unifiedChatgptUsed: boolean;
  manualCodexUsed: boolean;
  openAiChatgptVendor: boolean;
  openAiCodexVendor: boolean;
  codexEnterpriseUsed: boolean;
  codexEnterpriseSource: "none" | "live" | "sync";
  unifiedCodexUsed: boolean;
}): OpenAiF1SpendSources {
  let chatgpt: OpenAiF1SpendSources["chatgpt"] = "gateway";
  if (args.manualChatgptUsed) chatgpt = "manual_export";
  if (args.openAiChatgptVendor) chatgpt = "vendor";
  if (args.workspaceAnalyticsChatgptUsed) chatgpt = "workspace_analytics";
  if (args.unifiedChatgptUsed) chatgpt = "unified_credits";

  let codex: OpenAiF1SpendSources["codex"] = "gateway";
  if (args.manualCodexUsed) codex = "manual_export";
  if (args.openAiCodexVendor) codex = "openai_org_costs";
  if (args.codexEnterpriseUsed) {
    codex =
      args.codexEnterpriseSource === "live"
        ? "codex_enterprise_analytics_live"
        : "codex_enterprise_analytics_sync";
  }
  if (args.unifiedCodexUsed) codex = "unified_credits";

  return { chatgpt, codex };
}

/** Totals only — for the OpenAI card, per-product tiles, and leaderboard. */
export async function loadOpenAiSpendSnapshotForF1(
  prisma: PrismaClient,
  args: { periodStart: Date; periodEnd: Date; budgetMonthMultiplier?: number },
): Promise<OpenAiF1SpendSnapshot> {
  const gateway = getGatewayClient();
  const [programAgg, vendorManualExport, vendorOpenAi, vendorCodexEnterprise, workspaceChatgpt, unifiedCredits] =
    await Promise.all([
      gateway.aggregateByProgram({ periodStart: args.periodStart, periodEnd: args.periodEnd }),
      loadManualVendorExportSpendForF1(prisma, args),
      loadOpenAiVendorSpendForF1(prisma, args),
      loadCodexEnterpriseSpendForF1(prisma, args),
      loadChatGptWorkspaceAnalyticsSpendForF1(prisma, args),
      loadUnifiedCreditsSpendForF1(prisma, args),
    ]);

  const mtdMap = new Map<ProductKey, number>(
    programAgg
      .filter((r) => r.product === Product.CHATGPT || r.product === Product.CODEX)
      .map((r) => [r.product as ProductKey, r.totalUsd]),
  );

  mergeManualVendorExportIntoF1({
    mtdMap,
    days: [],
    chatgpt: vendorManualExport.chatgpt,
    codex: vendorManualExport.codex,
  });
  mergeOpenAiVendorIntoF1({
    mtdMap,
    days: [],
    chatgptVendorTotal: vendorOpenAi.chatgpt.periodTotalUsd,
    chatgptByChartDay: vendorOpenAi.chatgpt.byChartDay,
    useChatgptVendor: vendorOpenAi.chatgpt.usedVendor,
    codexVendorTotal: vendorOpenAi.codex.periodTotalUsd,
    codexByChartDay: vendorOpenAi.codex.byChartDay,
    useCodexVendor: vendorOpenAi.codex.usedVendor,
  });
  mergeChatGptWorkspaceAnalyticsIntoF1({
    mtdMap,
    days: [],
    chatgpt: workspaceChatgpt,
  });
  mergeCodexEnterpriseVendorIntoF1({
    mtdMap,
    days: [],
    codexVendorTotal: vendorCodexEnterprise.periodTotalUsd,
    codexByChartDay: vendorCodexEnterprise.byChartDay,
    useVendor: vendorCodexEnterprise.usedVendor,
  });
  mergeUnifiedCreditsChatGptIntoF1({ mtdMap, days: [], chatgpt: unifiedCredits.chatgpt });
  mergeUnifiedCreditsCodexIntoF1({ mtdMap, days: [], codex: unifiedCredits.codex });

  const chatgptUsd = mtdMap.get("CHATGPT") ?? 0;
  const codexUsd = mtdMap.get("CODEX") ?? 0;

  const sources = resolveOpenAiSources({
    manualChatgptUsed: vendorManualExport.chatgpt.used,
    workspaceAnalyticsChatgptUsed: workspaceChatgpt.used,
    unifiedChatgptUsed: unifiedCredits.chatgpt.used,
    manualCodexUsed: vendorManualExport.codex.used,
    openAiChatgptVendor: vendorOpenAi.chatgpt.usedVendor,
    openAiCodexVendor: vendorOpenAi.codex.usedVendor,
    codexEnterpriseUsed: vendorCodexEnterprise.usedVendor,
    codexEnterpriseSource: vendorCodexEnterprise.source,
    unifiedCodexUsed: unifiedCredits.codex.used,
  });

  const credits = resolveOpenAiF1Credits({
    chatgptUsd,
    codexUsd,
    budgetMonthMultiplier: args.budgetMonthMultiplier ?? 1,
    workspaceChatgptUsed: workspaceChatgpt.used,
    workspaceChatgptUsd: workspaceChatgpt.periodTotalUsd,
    manualChatgptUsed: vendorManualExport.chatgpt.used,
    manualChatgptUsd: vendorManualExport.chatgpt.periodTotalUsd,
    codexEnterpriseUsed: vendorCodexEnterprise.usedVendor,
    codexEnterpriseUsd: vendorCodexEnterprise.periodTotalUsd,
    unifiedChatgptUsed: unifiedCredits.chatgpt.used,
    unifiedChatgptUsd: unifiedCredits.chatgpt.periodTotalUsd,
    unifiedCodexUsed: unifiedCredits.codex.used,
    unifiedCodexUsd: unifiedCredits.codex.periodTotalUsd,
  });

  return {
    chatgptUsd,
    codexUsd,
    combinedUsd: chatgptUsd + codexUsd,
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
  const [vendorManualExport, vendorOpenAi, vendorCodexEnterprise, workspaceChatgpt, unifiedCredits] =
    await Promise.all([
      loadManualVendorExportSpendForF1(prisma, args),
      loadOpenAiVendorSpendForF1(prisma, args),
      loadCodexEnterpriseSpendForF1(prisma, args),
      loadChatGptWorkspaceAnalyticsSpendForF1(prisma, args),
      loadUnifiedCreditsSpendForF1(prisma, args),
    ]);

  mergeManualVendorExportIntoF1({
    mtdMap: args.mtdMap,
    days: args.days,
    chatgpt: vendorManualExport.chatgpt,
    codex: vendorManualExport.codex,
  });
  mergeOpenAiVendorIntoF1({
    mtdMap: args.mtdMap,
    days: args.days,
    chatgptVendorTotal: vendorOpenAi.chatgpt.periodTotalUsd,
    chatgptByChartDay: vendorOpenAi.chatgpt.byChartDay,
    useChatgptVendor: vendorOpenAi.chatgpt.usedVendor,
    codexVendorTotal: vendorOpenAi.codex.periodTotalUsd,
    codexByChartDay: vendorOpenAi.codex.byChartDay,
    useCodexVendor: vendorOpenAi.codex.usedVendor,
  });
  mergeChatGptWorkspaceAnalyticsIntoF1({
    mtdMap: args.mtdMap,
    days: args.days,
    chatgpt: workspaceChatgpt,
  });
  mergeCodexEnterpriseVendorIntoF1({
    mtdMap: args.mtdMap,
    days: args.days,
    codexVendorTotal: vendorCodexEnterprise.periodTotalUsd,
    codexByChartDay: vendorCodexEnterprise.byChartDay,
    useVendor: vendorCodexEnterprise.usedVendor,
  });
  mergeUnifiedCreditsChatGptIntoF1({
    mtdMap: args.mtdMap,
    days: args.days,
    chatgpt: unifiedCredits.chatgpt,
  });
  mergeUnifiedCreditsCodexIntoF1({
    mtdMap: args.mtdMap,
    days: args.days,
    codex: unifiedCredits.codex,
  });
}
