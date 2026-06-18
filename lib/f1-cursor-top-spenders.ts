/**
 * F1 Cursor top-10 from Cursor Team Admin per-user daily mirror
 * (`VendorUserDailySpend`), with gateway `UsageRecord` fallback.
 */

import { Product } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { getIntegrationMode } from "@/lib/integrations/env";
import {
  CURSOR_TEAM_ADMIN_VENDOR_KEY,
  normCursorUserEmail,
} from "@/lib/integrations/cursor/team-admin-usage";
import type { TopSpender } from "@/lib/integrations/gateway/types";
import { localYmd } from "@/lib/f1-cursor-vendor";

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

async function resolveUserIdsByEmail(
  prisma: PrismaClient,
  emails: string[],
): Promise<Map<string, string>> {
  const idByEmail = new Map<string, string>();
  const chunkSize = 40;
  for (let i = 0; i < emails.length; i += chunkSize) {
    const chunk = emails.slice(i, i + chunkSize);
    const dbUsers = await prisma.user.findMany({
      where: {
        OR: chunk.map((e) => ({ email: { equals: e, mode: "insensitive" as const } })),
      },
      select: { id: true, email: true },
    });
    for (const u of dbUsers) {
      const norm = normCursorUserEmail(u.email);
      if (norm) idByEmail.set(norm, u.id);
    }
  }
  return idByEmail;
}

export async function mergeCursorTopSpendersForF1(
  prisma: PrismaClient,
  args: {
    planPeriodStart: Date;
    planPeriodEnd: Date;
    gatewayTop: TopSpender[];
    limit: number;
  },
): Promise<{ rows: TopSpender[]; usedVendor: boolean }> {
  const limit = Math.max(1, Math.min(args.limit, 100));

  if (getIntegrationMode("cursor") !== "real") {
    return { rows: args.gatewayTop.slice(0, limit), usedVendor: false };
  }

  const { rangeStart, rangeEnd } = vendorDayRange(args.planPeriodStart, args.planPeriodEnd);
  const grouped = await prisma.vendorUserDailySpend.groupBy({
    by: ["userEmail"],
    where: {
      vendor: CURSOR_TEAM_ADMIN_VENDOR_KEY,
      product: Product.CURSOR,
      day: { gte: rangeStart, lte: rangeEnd },
    },
    _sum: { spendUsd: true, eventCount: true },
    orderBy: { _sum: { spendUsd: "desc" } },
    take: Math.max(limit, 40),
  });

  if (grouped.length === 0) {
    return { rows: args.gatewayTop.slice(0, limit), usedVendor: false };
  }

  const emails = grouped.map((g) => g.userEmail);
  const idByEmail = await resolveUserIdsByEmail(prisma, emails);

  const combined = new Map<string, { totalUsd: number; requestCount: number }>();
  for (const row of args.gatewayTop) {
    combined.set(row.userId, {
      totalUsd: row.totalUsd,
      requestCount: row.requestCount,
    });
  }

  for (const g of grouped) {
    const uid = idByEmail.get(g.userEmail);
    if (!uid) continue;
    const vendorUsd = g._sum.spendUsd ?? 0;
    const vendorEvents = g._sum.eventCount ?? 0;
    const prev = combined.get(uid);
    combined.set(uid, {
      totalUsd: Math.max(prev?.totalUsd ?? 0, vendorUsd),
      requestCount: Math.max(prev?.requestCount ?? 0, vendorEvents),
    });
  }

  const merged: TopSpender[] = [...combined.entries()].map(([userId, v]) => ({
    userId,
    totalUsd: v.totalUsd,
    requestCount: v.requestCount,
  }));
  merged.sort((a, b) => b.totalUsd - a.totalUsd);
  return { rows: merged.slice(0, limit), usedVendor: true };
}

/** @internal — exposed for tests */
export function vendorUserDayYmd(day: Date): string {
  return localYmd(day);
}
