/**
 * Merge vendor-synced spend into per-user MTD (Users detail).
 * Gateway `UsageRecord` mirror is often stale in prod; F1 already merges vendors.
 */

import { Product, type PrismaClient } from "@prisma/client";
import { inclusiveDayCountYmd } from "@/lib/imports/program-vendor-export/dates";
import { formatLocalYmd } from "@/lib/f1-period";
import { getIntegrationMode } from "@/lib/integrations/env";
import {
  CURSOR_TEAM_ADMIN_VENDOR_KEY,
  normCursorUserEmail,
} from "@/lib/integrations/cursor/team-admin-usage";
import { OPENAI_CREDIT_OVERAGE_USD, type ProductKey } from "@/lib/program";

export type UserMtdRow = { sum: number; count: number };
export type UserMtdSpendSource = "gateway" | "vendor";

function vendorDayRange(periodStart: Date, periodEnd: Date): {
  rangeStart: Date;
  rangeEnd: Date;
} {
  const startDay = new Date(periodStart);
  startDay.setHours(0, 0, 0, 0);
  const endDay = new Date(periodEnd);
  endDay.setHours(0, 0, 0, 0);
  return {
    rangeStart: new Date(startDay.getFullYear(), startDay.getMonth(), startDay.getDate(), 12, 0, 0, 0),
    rangeEnd: new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate(), 12, 0, 0, 0),
  };
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function overlapInclusiveDays(planStart: Date, planEnd: Date, expStart: Date, expEnd: Date): number {
  const a0 = startOfLocalDay(planStart);
  const a1 = startOfLocalDay(planEnd);
  const b0 = startOfLocalDay(expStart);
  const b1 = startOfLocalDay(expEnd);
  const lo = a0.getTime() > b0.getTime() ? a0 : b0;
  const hi = a1.getTime() < b1.getTime() ? a1 : b1;
  if (lo.getTime() > hi.getTime()) return 0;
  return inclusiveDayCountYmd(formatLocalYmd(lo), formatLocalYmd(hi));
}

function normEmail(e: string): string {
  return e.trim().toLowerCase();
}

function mergeProductUsd(
  mtdMap: Map<ProductKey, UserMtdRow>,
  product: ProductKey,
  usd: number,
  countBump: number,
  sources: Partial<Record<ProductKey, UserMtdSpendSource>>,
): void {
  if (!Number.isFinite(usd) || usd <= 0) return;
  const prev = mtdMap.get(product) ?? { sum: 0, count: 0 };
  if (usd >= prev.sum) {
    mtdMap.set(product, {
      sum: usd,
      count: Math.max(prev.count, countBump),
    });
    sources[product] = "vendor";
  }
}

async function chatGptCreditsUsdFromSnapshots(
  prisma: PrismaClient,
  email: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<number | null> {
  const target = normEmail(email);
  const snaps = await prisma.programVendorExportSnapshot.findMany({
    where: { kind: { in: ["CHATGPT_USERS_CSV", "CHATGPT_USER_ANALYTICS"] } },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: { periodStart: true, periodEnd: true, payload: true },
  });

  for (const snap of snaps) {
    if (!snap.periodStart || !snap.periodEnd) continue;
    const overlap = overlapInclusiveDays(periodStart, periodEnd, snap.periodStart, snap.periodEnd);
    if (overlap <= 0) continue;
    const exportDays = inclusiveDayCountYmd(
      formatLocalYmd(snap.periodStart),
      formatLocalYmd(snap.periodEnd),
    );
    if (exportDays <= 0) continue;

    const users = (snap.payload as { users?: { email: string; credits_used: number }[] }).users ?? [];
    const row = users.find((u) => normEmail(u.email) === target);
    if (!row) continue;
    const credits = typeof row.credits_used === "number" ? row.credits_used : Number(row.credits_used);
    if (!Number.isFinite(credits) || credits <= 0) continue;
    return credits * OPENAI_CREDIT_OVERAGE_USD * (overlap / exportDays);
  }
  return null;
}

export async function mergeUserMtdSpendFromVendors(args: {
  prisma: PrismaClient;
  userEmail: string;
  mtdMap: Map<ProductKey, UserMtdRow>;
  calendarMonthStart: Date;
  openAiPeriodStart: Date;
  periodEnd: Date;
  /** Codex credits from CODEX_SESSIONS_JSON posture (billing-period window). */
  codexCredits?: number | null;
}): Promise<Partial<Record<ProductKey, UserMtdSpendSource>>> {
  const sources: Partial<Record<ProductKey, UserMtdSpendSource>> = {};
  const email = normEmail(args.userEmail);

  if (getIntegrationMode("cursor") === "real") {
    const cursorEmail = normCursorUserEmail(email);
    if (cursorEmail) {
      const { rangeStart, rangeEnd } = vendorDayRange(args.calendarMonthStart, args.periodEnd);
      const agg = await args.prisma.vendorUserDailySpend.aggregate({
        where: {
          vendor: CURSOR_TEAM_ADMIN_VENDOR_KEY,
          product: Product.CURSOR,
          userEmail: cursorEmail,
          day: { gte: rangeStart, lte: rangeEnd },
        },
        _sum: { spendUsd: true, eventCount: true },
      });
      mergeProductUsd(
        args.mtdMap,
        "CURSOR",
        agg._sum?.spendUsd ?? 0,
        agg._sum?.eventCount ?? 0,
        sources,
      );
    }
  }

  if (args.codexCredits != null && args.codexCredits > 0) {
    mergeProductUsd(
      args.mtdMap,
      "CODEX",
      args.codexCredits * OPENAI_CREDIT_OVERAGE_USD,
      0,
      sources,
    );
  }

  const chatgptUsd = await chatGptCreditsUsdFromSnapshots(
    args.prisma,
    email,
    args.openAiPeriodStart,
    args.periodEnd,
  );
  if (chatgptUsd != null) {
    mergeProductUsd(args.mtdMap, "CHATGPT", chatgptUsd, 0, sources);
  }

  return sources;
}

export function sumUserMtd(mtdMap: Map<ProductKey, UserMtdRow>): number {
  return [...mtdMap.values()].reduce((acc, v) => acc + v.sum, 0);
}

export function projectUserEom(totalMtd: number, now: Date): number {
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return dayOfMonth > 0 ? (totalMtd / dayOfMonth) * daysInMonth : totalMtd;
}
