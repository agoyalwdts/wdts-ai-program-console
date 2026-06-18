/**
 * Shared F4 seat board builder — reads `License` rows where product is CURSOR
 * and joins usage for MTD + idle hints. Used by synthetic mode and as the
 * program-tier overlay when real mode unions SCIM workspace members.
 */

import { prisma } from "@/lib/prisma";
import type { CursorSeat, CursorSubTier } from "./types";

export function cursorLicenseSubTierToBoardTier(s: string): CursorSubTier {
  switch (s) {
    case "cursor_power":
      return "POWER";
    case "cursor_standard":
      return "STANDARD";
    case "cursor_light":
      return "LIGHT";
    case "cursor_discovery":
      return "DISCOVERY";
    default:
      console.warn(`[cursor] unknown License.subTier "${s}", mapping to DISCOVERY`);
      return "DISCOVERY";
  }
}

export async function listCursorSeatsFromPrisma(): Promise<CursorSeat[]> {
  const licenses = await prisma.license.findMany({
    where: { product: "CURSOR" },
    include: {
      user: {
        include: {
          usageRecords: {
            where: { product: "CURSOR", decision: "ALLOWED" },
            orderBy: { ts: "desc" },
            take: 1,
          },
        },
      },
    },
  });

  const userIds = licenses.map((l) => l.userId);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const mtd =
    userIds.length === 0
      ? []
      : await prisma.usageRecord.groupBy({
          by: ["userId"],
          where: {
            userId: { in: userIds },
            product: "CURSOR",
            ts: { gte: monthStart, lte: now },
          },
          _sum: { costUsd: true },
        });
  const mtdByUser = new Map(mtd.map((a) => [a.userId, a._sum.costUsd ?? 0]));

  return licenses.map<CursorSeat>((l) => {
    const lastTs = l.user.usageRecords[0]?.ts ?? null;
    const idleDays = lastTs
      ? Math.floor((now.getTime() - lastTs.getTime()) / (24 * 60 * 60 * 1000))
      : null;
    return {
      userId: l.userId,
      email: l.user.email,
      displayName: l.user.displayName,
      subTier: cursorLicenseSubTierToBoardTier(l.subTier),
      lastActivityTs: lastTs,
      idleDays,
      mtdSpendUsd: mtdByUser.get(l.userId) ?? 0,
    };
  });
}
