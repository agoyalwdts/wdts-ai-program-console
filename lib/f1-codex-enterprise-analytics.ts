/**
 * Merge Codex Enterprise Analytics VendorDailySpend into F1 (CODEX tile + chart).
 *
 * When INTEGRATION_CODEX_ENTERPRISE_ANALYTICS=real and rows exist from
 * {@link CODEX_ENTERPRISE_ANALYTICS_VENDOR_KEY}, overrides CODEX totals from
 * gateway and from OpenAI organization/costs (applied after mergeOpenAiVendorIntoF1).
 */

import { Product } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { getIntegrationMode } from "@/lib/integrations/env";
import { CODEX_ENTERPRISE_ANALYTICS_VENDOR_KEY } from "@/lib/integrations/codex-enterprise-analytics/fetch-workspace-usage";
import type { SpendPoint } from "@/components/charts/spend-trend-chart";
import type { ProductKey } from "@/lib/program";
import { localYmd } from "@/lib/f1-cursor-vendor";

function chartDayLabel(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export async function loadCodexEnterpriseVendorSpendForF1(
  prisma: PrismaClient,
  args: { periodStart: Date; periodEnd: Date },
): Promise<{
  periodTotalUsd: number;
  byChartDay: Map<string, number>;
  usedVendor: boolean;
}> {
  if (getIntegrationMode("codexenterprise") !== "real") {
    return { periodTotalUsd: 0, byChartDay: new Map(), usedVendor: false };
  }

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
