/**
 * Merge operator-uploaded ChatGPT / Codex admin exports (VendorDailySpend rows
 * under MANUAL_* vendor keys) into F1. Applied before OpenAI org costs and
 * Codex Enterprise Analytics so live APIs still win when configured.
 */

import { Product } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { SpendPoint } from "@/components/charts/spend-trend-chart";
import type { ProductKey } from "@/lib/program";
import { localYmd } from "@/lib/f1-cursor-vendor";
import {
  MANUAL_CHATGPT_USERS_CSV_VENDOR_KEY,
  MANUAL_CODEX_ADMIN_EXPORT_VENDOR_KEY,
} from "@/lib/imports/program-vendor-export/vendor-keys";

function chartDayLabel(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

type ManualSeries = {
  periodTotalUsd: number;
  byChartDay: Map<string, number>;
  used: boolean;
};

async function loadManualProductSeries(
  prisma: PrismaClient,
  args: { periodStart: Date; periodEnd: Date; vendor: string; product: Product },
): Promise<ManualSeries> {
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
      vendor: args.vendor,
      product: args.product,
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

export async function loadManualVendorExportSpendForF1(
  prisma: PrismaClient,
  args: { periodStart: Date; periodEnd: Date },
): Promise<{
  chatgpt: ManualSeries;
  codex: ManualSeries;
}> {
  const [chatgpt, codex] = await Promise.all([
    loadManualProductSeries(prisma, {
      ...args,
      vendor: MANUAL_CHATGPT_USERS_CSV_VENDOR_KEY,
      product: Product.CHATGPT,
    }),
    loadManualProductSeries(prisma, {
      ...args,
      vendor: MANUAL_CODEX_ADMIN_EXPORT_VENDOR_KEY,
      product: Product.CODEX,
    }),
  ]);
  return { chatgpt, codex };
}

export function mergeManualVendorExportIntoF1(args: {
  mtdMap: Map<ProductKey, number>;
  days: SpendPoint[];
  chatgpt: ManualSeries;
  codex: ManualSeries;
}): void {
  if (args.chatgpt.used) {
    args.mtdMap.set("CHATGPT" as ProductKey, args.chatgpt.periodTotalUsd);
    for (const row of args.days) {
      row.CHATGPT = args.chatgpt.byChartDay.get(row.day) ?? 0;
    }
  }
  if (args.codex.used) {
    args.mtdMap.set("CODEX" as ProductKey, args.codex.periodTotalUsd);
    for (const row of args.days) {
      row.CODEX = args.codex.byChartDay.get(row.day) ?? 0;
    }
  }
}
