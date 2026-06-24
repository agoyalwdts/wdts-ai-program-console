/**
 * F1 / chargeback program-level spend from Unified Credits COSTS sync
 * (`VendorDailySpend` under OPENAI_UNIFIED_CREDITS_COMPLIANCE).
 */

import { Product } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { SpendPoint } from "@/components/charts/spend-trend-chart";
import { localYmd } from "@/lib/f1-cursor-vendor";
import { UNIFIED_CREDITS_VENDOR_KEY } from "@/lib/integrations/unified-credits/constants";
import type { ProductKey } from "@/lib/program";

export type UnifiedCreditsProductSeries = {
  periodTotalUsd: number;
  byChartDay: Map<string, number>;
  used: boolean;
};

export type UnifiedCreditsF1Spend = {
  chatgpt: UnifiedCreditsProductSeries;
  codex: UnifiedCreditsProductSeries;
};

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

function seriesFromRows(args: {
  periodStart: Date;
  periodEnd: Date;
  rows: { day: Date; spendUsd: number }[];
}): UnifiedCreditsProductSeries {
  if (args.rows.length === 0) {
    return { periodTotalUsd: 0, byChartDay: new Map(), used: false };
  }

  const vendorByLocalYmd = new Map<string, number>();
  for (const r of args.rows) {
    const ymd = localYmd(r.day);
    vendorByLocalYmd.set(ymd, (vendorByLocalYmd.get(ymd) ?? 0) + r.spendUsd);
  }

  const startDay = new Date(args.periodStart);
  startDay.setHours(0, 0, 0, 0);
  const endDay = new Date(args.periodEnd);
  endDay.setHours(0, 0, 0, 0);

  let periodTotalUsd = 0;
  const byChartDay = new Map<string, number>();
  for (let d = new Date(startDay); d.getTime() <= endDay.getTime(); d.setDate(d.getDate() + 1)) {
    const cur = new Date(d);
    const usd = vendorByLocalYmd.get(localYmd(cur)) ?? 0;
    periodTotalUsd += usd;
    byChartDay.set(chartDayLabel(cur), usd);
  }

  return { periodTotalUsd, byChartDay, used: periodTotalUsd > 0 };
}

export async function loadUnifiedCreditsSpendForF1(
  prisma: PrismaClient,
  args: { periodStart: Date; periodEnd: Date },
): Promise<UnifiedCreditsF1Spend> {
  const { rangeStart, rangeEnd } = vendorDayRange(args.periodStart, args.periodEnd);

  const rows = await prisma.vendorDailySpend.findMany({
    where: {
      vendor: UNIFIED_CREDITS_VENDOR_KEY,
      product: { in: [Product.CHATGPT, Product.CODEX] },
      day: { gte: rangeStart, lte: rangeEnd },
    },
    select: { product: true, day: true, spendUsd: true },
  });

  const chatgptRows = rows.filter((r) => r.product === Product.CHATGPT);
  const codexRows = rows.filter((r) => r.product === Product.CODEX);

  return {
    chatgpt: seriesFromRows({
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      rows: chatgptRows,
    }),
    codex: seriesFromRows({
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      rows: codexRows,
    }),
  };
}

export function mergeUnifiedCreditsChatGptIntoF1(args: {
  mtdMap: Map<ProductKey, number>;
  days: SpendPoint[];
  chatgpt: UnifiedCreditsProductSeries;
}): void {
  if (!args.chatgpt.used) return;
  args.mtdMap.set("CHATGPT" as ProductKey, args.chatgpt.periodTotalUsd);
  for (const row of args.days) {
    row.CHATGPT = args.chatgpt.byChartDay.get(row.day) ?? 0;
  }
}

export function mergeUnifiedCreditsCodexIntoF1(args: {
  mtdMap: Map<ProductKey, number>;
  days: SpendPoint[];
  codex: UnifiedCreditsProductSeries;
}): void {
  if (!args.codex.used) return;
  args.mtdMap.set("CODEX" as ProductKey, args.codex.periodTotalUsd);
  for (const row of args.days) {
    row.CODEX = args.codex.byChartDay.get(row.day) ?? 0;
  }
}
