/**
 * Merge OpenAI organization cost buckets (VendorDailySpend) into F1 aggregates.
 *
 * When `INTEGRATION_OPENAI=real` and rows exist for CHATGPT/CODEX from
 * {@link OPENAI_ORG_COSTS_VENDOR_KEY}, those tiles and chart series use vendor
 * data instead of gateway UsageRecord sums.
 */

import { Product } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { getIntegrationMode } from "@/lib/integrations/env";
import { OPENAI_ORG_COSTS_VENDOR_KEY } from "@/lib/integrations/openai/org-costs";
import type { SpendPoint } from "@/components/charts/spend-trend-chart";
import type { ProductKey } from "@/lib/program";
import { localYmd } from "@/lib/f1-cursor-vendor";
import type { OpenAiCostProduct } from "@/lib/integrations/openai/cost-line-item";

export type OpenAiVendorSeries = {
  periodTotalUsd: number;
  byChartDay: Map<string, number>;
  usedVendor: boolean;
};

function chartDayLabel(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

async function loadProductVendorSeries(
  prisma: PrismaClient,
  args: { periodStart: Date; periodEnd: Date; product: OpenAiCostProduct },
): Promise<OpenAiVendorSeries> {
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
      vendor: OPENAI_ORG_COSTS_VENDOR_KEY,
      product: args.product,
      day: { gte: rangeStart, lte: rangeEnd },
    },
  });

  if (rows.length === 0) {
    return { periodTotalUsd: 0, byChartDay: new Map(), usedVendor: false };
  }

  const vendorByLocalYmd = new Map<string, number>();
  for (const r of rows) {
    const ymd = localYmd(r.day);
    vendorByLocalYmd.set(ymd, (vendorByLocalYmd.get(ymd) ?? 0) + r.spendUsd);
  }

  let periodTotalUsd = 0;
  const byChartDay = new Map<string, number>();

  for (let d = new Date(startDay); d.getTime() <= endDay.getTime(); d.setDate(d.getDate() + 1)) {
    const cur = new Date(d);
    const ymd = localYmd(cur);
    const usd = vendorByLocalYmd.get(ymd) ?? 0;
    periodTotalUsd += usd;
    const label = chartDayLabel(cur);
    byChartDay.set(label, usd);
  }

  return { periodTotalUsd, byChartDay, usedVendor: true };
}

export async function loadOpenAiVendorSpendForF1(
  prisma: PrismaClient,
  args: { periodStart: Date; periodEnd: Date },
): Promise<{
  chatgpt: OpenAiVendorSeries;
  codex: OpenAiVendorSeries;
}> {
  if (getIntegrationMode("openai") !== "real") {
    const empty: OpenAiVendorSeries = { periodTotalUsd: 0, byChartDay: new Map(), usedVendor: false };
    return { chatgpt: empty, codex: empty };
  }

  const [chatgpt, codex] = await Promise.all([
    loadProductVendorSeries(prisma, { ...args, product: Product.CHATGPT }),
    loadProductVendorSeries(prisma, { ...args, product: Product.CODEX }),
  ]);
  return { chatgpt, codex };
}

export function mergeOpenAiVendorIntoF1(args: {
  mtdMap: Map<ProductKey, number>;
  days: SpendPoint[];
  chatgptVendorTotal: number;
  chatgptByChartDay: Map<string, number>;
  useChatgptVendor: boolean;
  codexVendorTotal: number;
  codexByChartDay: Map<string, number>;
  useCodexVendor: boolean;
}): void {
  if (args.useChatgptVendor) {
    args.mtdMap.set("CHATGPT" as ProductKey, args.chatgptVendorTotal);
    for (const row of args.days) {
      row.CHATGPT = args.chatgptByChartDay.get(row.day) ?? 0;
    }
  }
  if (args.useCodexVendor) {
    args.mtdMap.set("CODEX" as ProductKey, args.codexVendorTotal);
    for (const row of args.days) {
      row.CODEX = args.codexByChartDay.get(row.day) ?? 0;
    }
  }
}
