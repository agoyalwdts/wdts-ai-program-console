/**
 * Codex Enterprise Analytics → F1 (CODEX tile + daily chart).
 *
 * When `INTEGRATION_CODEX_ENTERPRISE_ANALYTICS=real`, F1 reads the Postgres
 * mirror first (populated by layout refresh + cron). Live API is fallback only
 * when the mirror is empty.
 */

import { Product } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { getIntegrationMode } from "@/lib/integrations/env";
import {
  aggregateWorkspaceUsageSpendByLocalYmd,
  localYmdFromDate,
} from "@/lib/integrations/codex-enterprise-analytics/aggregate-workspace-daily";
import {
  CODEX_ENTERPRISE_ANALYTICS_VENDOR_KEY,
  fetchCodexEnterpriseWorkspaceUsageRows,
  resolveCodexEnterpriseAnalyticsCredentials,
  resolveUsdPerCredit,
} from "@/lib/integrations/codex-enterprise-analytics/fetch-workspace-usage";
import type { Fetch } from "@/lib/integrations/_http";
import type { SpendPoint } from "@/components/charts/spend-trend-chart";
import type { ProductKey } from "@/lib/program";
import { localYmd } from "@/lib/f1-cursor-vendor";

export type CodexEnterpriseF1Source = "none" | "live" | "sync";

export type CodexEnterpriseF1Spend = {
  periodTotalUsd: number;
  byChartDay: Map<string, number>;
  usedVendor: boolean;
  source: CodexEnterpriseF1Source;
};

function chartDayLabel(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function seriesFromSpendByLocalYmd(args: {
  periodStart: Date;
  periodEnd: Date;
  spendByLocalYmd: Map<string, number>;
}): { periodTotalUsd: number; byChartDay: Map<string, number> } {
  const startDay = new Date(args.periodStart);
  startDay.setHours(0, 0, 0, 0);
  const endDay = new Date(args.periodEnd);
  endDay.setHours(0, 0, 0, 0);

  let periodTotalUsd = 0;
  const byChartDay = new Map<string, number>();

  for (let d = new Date(startDay); d.getTime() <= endDay.getTime(); d.setDate(d.getDate() + 1)) {
    const cur = new Date(d);
    const ymd = localYmdFromDate(cur);
    const usd = args.spendByLocalYmd.get(ymd) ?? 0;
    periodTotalUsd += usd;
    byChartDay.set(chartDayLabel(cur), usd);
  }

  return { periodTotalUsd, byChartDay };
}

async function loadCodexEnterpriseLiveSpendForF1(args: {
  periodStart: Date;
  periodEnd: Date;
  env?: Record<string, string | undefined>;
  fetchImpl?: Fetch;
}): Promise<CodexEnterpriseF1Spend | null> {
  const env = args.env ?? process.env;
  const creds = resolveCodexEnterpriseAnalyticsCredentials(env);
  if (!creds) return null;

  const startTimeSec = Math.floor(args.periodStart.getTime() / 1000);
  const endTimeSec = Math.floor(args.periodEnd.getTime() / 1000);
  if (endTimeSec <= startTimeSec) {
    return {
      periodTotalUsd: 0,
      byChartDay: new Map(),
      usedVendor: true,
      source: "live",
    };
  }

  const rows = await fetchCodexEnterpriseWorkspaceUsageRows({
    startTimeSec,
    endTimeSec,
    creds,
    fetchImpl: args.fetchImpl,
  });
  const usdPerCredit = resolveUsdPerCredit(env);
  const spendByLocalYmd = aggregateWorkspaceUsageSpendByLocalYmd(rows, usdPerCredit);
  const { periodTotalUsd, byChartDay } = seriesFromSpendByLocalYmd({
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    spendByLocalYmd,
  });

  return {
    periodTotalUsd,
    byChartDay,
    usedVendor: true,
    source: "live",
  };
}

async function loadCodexEnterpriseSyncedSpendForF1(
  prisma: PrismaClient,
  args: { periodStart: Date; periodEnd: Date },
): Promise<CodexEnterpriseF1Spend> {
  const startDay = new Date(args.periodStart);
  startDay.setHours(0, 0, 0, 0);
  const endDay = new Date(args.periodEnd);
  endDay.setHours(0, 0, 0, 0);

  const rangeStart = new Date(
    startDay.getFullYear(),
    startDay.getMonth(),
    startDay.getDate(),
    12,
    0,
    0,
    0,
  );
  const rangeEnd = new Date(
    endDay.getFullYear(),
    endDay.getMonth(),
    endDay.getDate(),
    12,
    0,
    0,
    0,
  );

  const rows = await prisma.vendorDailySpend.findMany({
    where: {
      vendor: CODEX_ENTERPRISE_ANALYTICS_VENDOR_KEY,
      product: Product.CODEX,
      day: { gte: rangeStart, lte: rangeEnd },
    },
  });

  if (rows.length === 0) {
    return { periodTotalUsd: 0, byChartDay: new Map(), usedVendor: false, source: "none" };
  }

  const spendByLocalYmd = new Map<string, number>();
  for (const r of rows) {
    const ymd = localYmd(r.day);
    spendByLocalYmd.set(ymd, (spendByLocalYmd.get(ymd) ?? 0) + r.spendUsd);
  }

  const { periodTotalUsd, byChartDay } = seriesFromSpendByLocalYmd({
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    spendByLocalYmd,
  });

  return { periodTotalUsd, byChartDay, usedVendor: true, source: "sync" };
}

/** @deprecated Use {@link loadCodexEnterpriseSpendForF1}. */
export const loadCodexEnterpriseVendorSpendForF1 = loadCodexEnterpriseSpendForF1;

export async function loadCodexEnterpriseSpendForF1(
  prisma: PrismaClient,
  args: {
    periodStart: Date;
    periodEnd: Date;
    env?: Record<string, string | undefined>;
    fetchImpl?: Fetch;
  },
): Promise<CodexEnterpriseF1Spend> {
  if (getIntegrationMode("codexenterprise", args.env) !== "real") {
    return { periodTotalUsd: 0, byChartDay: new Map(), usedVendor: false, source: "none" };
  }

  const synced = await loadCodexEnterpriseSyncedSpendForF1(prisma, args);
  if (synced.usedVendor) return synced;

  try {
    const live = await loadCodexEnterpriseLiveSpendForF1(args);
    if (live) return live;
  } catch (err) {
    console.error(
      "[f1/codex-enterprise] live workspace usage failed; mirror empty",
      err,
    );
  }

  return synced;
}

export function mergeCodexEnterpriseVendorIntoF1(args: {
  mtdMap: Map<ProductKey, number>;
  days: SpendPoint[];
  codexVendorTotal: number;
  codexByChartDay: Map<string, number>;
  useVendor: boolean;
}): void {
  if (!args.useVendor) return;
  args.mtdMap.set("CODEX" as ProductKey, args.codexVendorTotal);
  for (const row of args.days) {
    row.CODEX = args.codexByChartDay.get(row.day) ?? 0;
  }
}
