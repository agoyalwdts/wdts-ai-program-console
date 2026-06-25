/**
 * Program-wide observed USD (gateway + vendor mirrors) for F1 planning comparisons.
 */

import type { PrismaClient } from "@prisma/client";
import { getGatewayClient } from "@/lib/integrations";
import { loadCursorVendorSpendForF1, mergeCursorVendorIntoF1 } from "@/lib/f1-cursor-vendor";
import { mergeOpenAiSpendIntoPagePeriodF1 } from "@/lib/f1-openai-spend";
import { formatF1DateRange } from "@/lib/f1-period";
import {
  cursorProgramStartDate,
  MONTHLY_BUDGET_USD,
  OPENAI_COMBINED_MONTHLY_PLANNING_USD,
  PRODUCTS,
  PROGRAM_ANNUAL_PLANNING_YTD_ACTUALS_USD,
  YTD_ACTUALS_EXCLUDED_PRODUCTS,
  type ProductKey,
} from "@/lib/program";

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
  excludeProducts?: ProductKey[];
}): number {
  return PRODUCTS.reduce((acc, { key }) => {
    if (args.excludeProducts?.includes(key)) return acc;
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

/** Cursor YTD slice — null when the program had not started before period end. */
export function effectiveCursorYtdWindow(args: {
  ytdPeriodStart: Date;
  ytdPeriodEnd: Date;
  cursorProgramStart?: Date;
}): { periodStart: Date; periodEnd: Date } | null {
  const cursorStart = args.cursorProgramStart ?? cursorProgramStartDate();
  if (cursorStart.getTime() > args.ytdPeriodEnd.getTime()) return null;
  return {
    periodStart: new Date(Math.max(args.ytdPeriodStart.getTime(), cursorStart.getTime())),
    periodEnd: args.ytdPeriodEnd,
  };
}

/** Prorated planning USD for the calendar-YTD actuals scope (no Claude; Cursor from go-live). */
export function programPlanningYtdUsdForActuals(now: Date = new Date()): number {
  const { periodStart, periodEnd } = calendarYearToDateWindow(now);
  const openAiAndCopilotMultiplier = budgetMonthMultiplierForWindow(periodStart, periodEnd);

  let total =
    OPENAI_COMBINED_MONTHLY_PLANNING_USD * openAiAndCopilotMultiplier +
    MONTHLY_BUDGET_USD.M365_COPILOT * openAiAndCopilotMultiplier;

  const cursorWindow = effectiveCursorYtdWindow({
    ytdPeriodStart: periodStart,
    ytdPeriodEnd: periodEnd,
  });
  if (cursorWindow) {
    total +=
      MONTHLY_BUDGET_USD.CURSOR *
      budgetMonthMultiplierForWindow(cursorWindow.periodStart, cursorWindow.periodEnd);
  }

  return total;
}

/**
 * Calendar-YTD observed spend for F1: Claude excluded; Cursor counted from
 * {@link cursorProgramStartDate} only.
 */
export async function loadProgramYtdObservedSpendUsd(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<ProgramObservedSpend> {
  const window = calendarYearToDateWindow(now);
  const observed = await loadProgramObservedSpendUsd(prisma, window);

  const cursorWindow = effectiveCursorYtdWindow({
    ytdPeriodStart: window.periodStart,
    ytdPeriodEnd: window.periodEnd,
  });
  if (cursorWindow) {
    const cursorSlice = await loadProgramObservedSpendUsd(prisma, cursorWindow);
    observed.byProduct.set("CURSOR", cursorSlice.byProduct.get("CURSOR") ?? 0);
  } else {
    observed.byProduct.set("CURSOR", 0);
  }

  observed.totalUsd = programObservedTotalUsd({
    byProduct: observed.byProduct,
    budgetMonthMultiplier: observed.budgetMonthMultiplier,
    excludeProducts: YTD_ACTUALS_EXCLUDED_PRODUCTS,
  });

  return observed;
}

/** Annualize YTD actuals using the matching prorated planning envelope. */
export function annualizedProgramActualUsdForYtd(args: {
  observedYtdUsd: number;
  planningYtdUsd: number;
}): number {
  if (args.planningYtdUsd <= 0) return 0;
  return (args.observedYtdUsd / args.planningYtdUsd) * PROGRAM_ANNUAL_PLANNING_YTD_ACTUALS_USD;
}
