/**
 * Merge ChatGPT spend from Workspace Analytics API sync (VendorDailySpend under
 * WORKSPACE_ANALYTICS_API). Daily CHATGPT_USER_ANALYTICS cron rows — same credit
 * basis as the manual Business users CSV, but automated.
 */

import { Product } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { SpendPoint } from "@/components/charts/spend-trend-chart";
import { localYmd } from "@/lib/f1-cursor-vendor";
import { WORKSPACE_ANALYTICS_USER_VENDOR_KEY } from "@/lib/integrations/workspace-analytics/vendor-key";
import type { ProductKey } from "@/lib/program";

export type ChatGptWorkspaceAnalyticsSeries = {
  periodTotalUsd: number;
  byChartDay: Map<string, number>;
  used: boolean;
};

function chartDayLabel(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export async function loadChatGptWorkspaceAnalyticsSpendForF1(
  prisma: PrismaClient,
  args: { periodStart: Date; periodEnd: Date },
): Promise<ChatGptWorkspaceAnalyticsSeries> {
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
      vendor: WORKSPACE_ANALYTICS_USER_VENDOR_KEY,
      product: Product.CHATGPT,
      day: { gte: rangeStart, lte: rangeEnd },
    },
  });

  if (rows.length === 0) {
    return { periodTotalUsd: 0, byChartDay: new Map(), used: false };
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
    byChartDay.set(chartDayLabel(cur), usd);
  }

  return { periodTotalUsd, byChartDay, used: true };
}

export function mergeChatGptWorkspaceAnalyticsIntoF1(args: {
  mtdMap: Map<ProductKey, number>;
  days: SpendPoint[];
  chatgpt: ChatGptWorkspaceAnalyticsSeries;
}): void {
  if (!args.chatgpt.used) return;
  args.mtdMap.set("CHATGPT" as ProductKey, args.chatgpt.periodTotalUsd);
  for (const row of args.days) {
    row.CHATGPT = args.chatgpt.byChartDay.get(row.day) ?? 0;
  }
}
