/**
 * Merge Cursor Team Admin per-user daily mirror into F4 seat rows.
 * Gateway `UsageRecord` MTD / idle is often stale in prod; F1 already uses
 * `VendorUserDailySpend`.
 */

import { Product, type PrismaClient } from "@prisma/client";
import { getIntegrationMode } from "@/lib/integrations/env";
import {
  CURSOR_TEAM_ADMIN_VENDOR_KEY,
  normCursorUserEmail,
} from "@/lib/integrations/cursor/team-admin-usage";
import type { CursorSeat } from "./types";

const ACTIVITY_LOOKBACK_DAYS = 90;

function vendorDayRange(periodStart: Date, periodEnd: Date): {
  rangeStart: Date;
  rangeEnd: Date;
} {
  const startDay = new Date(periodStart);
  startDay.setHours(0, 0, 0, 0);
  const endDay = new Date(periodEnd);
  endDay.setHours(0, 0, 0, 0);
  return {
    rangeStart: new Date(
      startDay.getFullYear(),
      startDay.getMonth(),
      startDay.getDate(),
      12,
      0,
      0,
      0,
    ),
    rangeEnd: new Date(
      endDay.getFullYear(),
      endDay.getMonth(),
      endDay.getDate(),
      12,
      0,
      0,
      0,
    ),
  };
}

function idleDaysSince(lastActivity: Date, now: Date): number {
  return Math.floor((now.getTime() - lastActivity.getTime()) / (24 * 60 * 60 * 1000));
}

export async function enrichCursorSeatsWithVendorSpend(
  prisma: PrismaClient,
  seats: CursorSeat[],
  now = new Date(),
): Promise<CursorSeat[]> {
  if (getIntegrationMode("cursor") !== "real" || seats.length === 0) {
    return seats;
  }

  const emails = [
    ...new Set(
      seats
        .map((s) => normCursorUserEmail(s.email))
        .filter((e): e is string => e != null),
    ),
  ];
  if (emails.length === 0) return seats;

  const calendarMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const { rangeStart: mtdStart, rangeEnd: mtdEnd } = vendorDayRange(calendarMonthStart, now);

  const lookbackStart = new Date(now.getTime() - ACTIVITY_LOOKBACK_DAYS * 86_400_000);
  const { rangeStart: activityStart, rangeEnd: activityEnd } = vendorDayRange(
    lookbackStart,
    now,
  );

  const [mtdGrouped, activityRows] = await Promise.all([
    prisma.vendorUserDailySpend.groupBy({
      by: ["userEmail"],
      where: {
        vendor: CURSOR_TEAM_ADMIN_VENDOR_KEY,
        product: Product.CURSOR,
        userEmail: { in: emails },
        day: { gte: mtdStart, lte: mtdEnd },
      },
      _sum: { spendUsd: true },
    }),
    prisma.vendorUserDailySpend.findMany({
      where: {
        vendor: CURSOR_TEAM_ADMIN_VENDOR_KEY,
        product: Product.CURSOR,
        userEmail: { in: emails },
        day: { gte: activityStart, lte: activityEnd },
        OR: [{ spendUsd: { gt: 0 } }, { eventCount: { gt: 0 } }],
      },
      select: { userEmail: true, day: true },
    }),
  ]);

  const mtdByEmail = new Map(
    mtdGrouped.map((g) => [g.userEmail, g._sum?.spendUsd ?? 0]),
  );
  const lastDayByEmail = new Map<string, Date>();
  for (const row of activityRows) {
    const prev = lastDayByEmail.get(row.userEmail);
    if (!prev || row.day.getTime() > prev.getTime()) {
      lastDayByEmail.set(row.userEmail, row.day);
    }
  }

  return seats.map((seat) => {
    const email = normCursorUserEmail(seat.email);
    if (!email) return seat;

    const vendorMtd = mtdByEmail.get(email);
    const vendorLastDay = lastDayByEmail.get(email);

    let mtdSpendUsd = seat.mtdSpendUsd;
    let lastActivityTs = seat.lastActivityTs;
    let idleDays = seat.idleDays;

    if (vendorMtd != null && vendorMtd > mtdSpendUsd) {
      mtdSpendUsd = vendorMtd;
    }

    if (vendorLastDay) {
      const gatewayTs = seat.lastActivityTs;
      if (!gatewayTs || vendorLastDay.getTime() > gatewayTs.getTime()) {
        lastActivityTs = vendorLastDay;
        idleDays = idleDaysSince(vendorLastDay, now);
      }
    }

    if (
      mtdSpendUsd === seat.mtdSpendUsd &&
      lastActivityTs === seat.lastActivityTs &&
      idleDays === seat.idleDays
    ) {
      return seat;
    }

    return { ...seat, mtdSpendUsd, lastActivityTs, idleDays };
  });
}
