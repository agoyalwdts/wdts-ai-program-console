/**
 * Program-wide observed USD (gateway + vendor mirrors) for F1 planning comparisons.
 */

import type { PrismaClient } from "@prisma/client";
import { getGatewayClient } from "@/lib/integrations";
import { loadCursorVendorSpendForF1, mergeCursorVendorIntoF1 } from "@/lib/f1-cursor-vendor";
import { mergeOpenAiSpendIntoPagePeriodF1 } from "@/lib/f1-openai-spend";
import { formatF1DateRange } from "@/lib/f1-period";
import { MONTHLY_BUDGET_USD, PRODUCTS, type ProductKey } from "@/lib/program";

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/** Prorate monthly planning envelopes to an arbitrary inclusive window. */
export function budgetMonthMultiplierForWindow(periodStart: Date, periodEnd: Date): number {
  const lo = startOfLocalDay(periodStart);
  const hi = startOfLocalDay(periodEnd);
  const effectiveDays = Math.max(
    1,
    Math.floor((hi.getTime() - lo.getTime()) / (24 * 60 * 60 * 1000)) + 1,
  );
  return effectiveDays / 30.4375;
}

export type ProgramObservedSpend = {
  byProduct: Map<ProductKey, number>;
  budgetMonthMultiplier: number;
  totalUsd: number;
  rangeDescription: string;
};

export function programObservedTotalUsd(args: {
  byProduct: Map<ProductKey, number>;
  budgetMonthMultiplier: number;
}): number {
  return PRODUCTS.reduce((acc, { key }) => {
    if (key === "M365_COPILOT") {
      return acc + MONTHLY_BUDGET_USD.M365_COPILOT * args.budgetMonthMultiplier;
    }
    return acc + (args.byProduct.get(key) ?? 0);
  }, 0);
}

export async function loadProgramObservedSpendUsd(
  prisma: PrismaClient,
  args: { periodStart: Date; periodEnd: Date },
): Promise<ProgramObservedSpend> {
  const gateway = getGatewayClient();
  const budgetMonthMultiplier = budgetMonthMultiplierForWindow(args.periodStart, args.periodEnd);

  const [programAgg, vendorCursor] = await Promise.all([
    gateway.aggregateByProgram({
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
    }),
    loadCursorVendorSpendForF1(prisma, {
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
    }),
  ]);

  const byProduct = new Map<ProductKey, number>(
    programAgg.map((r) => [r.product as ProductKey, r.totalUsd]),
  );

  mergeCursorVendorIntoF1({
    mtdMap: byProduct,
    days: [],
    cursorVendorTotal: vendorCursor.periodTotalUsd,
    cursorByChartDay: vendorCursor.byChartDay,
    useVendor: vendorCursor.usedVendor,
  });

  await mergeOpenAiSpendIntoPagePeriodF1(prisma, {
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    mtdMap: byProduct,
    days: [],
  });

  return {
    byProduct,
    budgetMonthMultiplier,
    totalUsd: programObservedTotalUsd({ byProduct, budgetMonthMultiplier }),
    rangeDescription: formatF1DateRange(args.periodStart, args.periodEnd),
  };
}

/** Calendar year window [Jan 1, now] for YTD comparisons. */
export function calendarYearToDateWindow(now: Date = new Date()): {
  periodStart: Date;
  periodEnd: Date;
} {
  return {
    periodStart: new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0),
    periodEnd: now,
  };
}
