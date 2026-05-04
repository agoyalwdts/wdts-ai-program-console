/**
 * Merge Cursor vendor daily spend (Team Admin API mirror) into F1 aggregates.
 *
 * When `INTEGRATION_CURSOR=real` and VendorDailySpend rows exist for days in
 * the selected period, CURSOR totals and the stacked chart use vendor data
 * instead of gateway UsageRecord sums (avoids $0 when gateway ingest is empty).
 */

import { Product } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { getIntegrationMode } from "@/lib/integrations/env";
import { CURSOR_TEAM_ADMIN_VENDOR_KEY } from "@/lib/integrations/cursor/team-admin-usage";
import type { SpendPoint } from "@/components/charts/spend-trend-chart";
import type { ProductKey } from "@/lib/program";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local calendar YYYY-MM-DD (matches gateway daily loop semantics on the server). */
export function localYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function chartDayLabel(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export async function loadCursorVendorSpendForF1(
  prisma: PrismaClient,
  args: { periodStart: Date; periodEnd: Date },
): Promise<{
  periodTotalUsd: number;
  /** Chart day label (M/D) → USD */
  byChartDay: Map<string, number>;
  usedVendor: boolean;
}> {
  if (getIntegrationMode("cursor") !== "real") {
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
      vendor: CURSOR_TEAM_ADMIN_VENDOR_KEY,
      product: Product.CURSOR,
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

export function mergeCursorVendorIntoF1(args: {
  mtdMap: Map<ProductKey, number>;
  days: SpendPoint[];
  cursorVendorTotal: number;
  cursorByChartDay: Map<string, number>;
  useVendor: boolean;
}): void {
  if (!args.useVendor) return;
  args.mtdMap.set("CURSOR" as ProductKey, args.cursorVendorTotal);
  for (const row of args.days) {
    row.CURSOR = args.cursorByChartDay.get(row.day) ?? 0;
  }
}
