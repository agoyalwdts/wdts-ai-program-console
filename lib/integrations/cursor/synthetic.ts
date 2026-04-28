/**
 * Synthetic CursorClient — derives the 84-seat board from the dev DB
 * (License rows where product='CURSOR') and synthesises a small waitlist.
 *
 * The waitlist isn't represented in the v0.1 schema; the v0.2 schema will
 * add a CursorWaitlistEntry model. Until then, we synthesise a small
 * deterministic list so F4 has something to render.
 */

import { prisma } from "@/lib/prisma";
import type { CursorClient, CursorSeat, CursorSubTier, CursorWaitlistEntry } from "./types";

function asSubTier(s: string): CursorSubTier {
  switch (s) {
    case "cursor_power":
      return "POWER";
    case "cursor_standard":
      return "STANDARD";
    case "cursor_light":
      return "LIGHT";
    default:
      throw new Error(`Unknown Cursor sub-tier from DB: ${s}`);
  }
}

export const syntheticCursorClient: CursorClient = {
  async listSeats(): Promise<CursorSeat[]> {
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
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const mtd = await prisma.usageRecord.groupBy({
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
        subTier: asSubTier(l.subTier),
        lastActivityTs: lastTs,
        idleDays,
        mtdSpendUsd: mtdByUser.get(l.userId) ?? 0,
      };
    });
  },

  async listWaitlist(): Promise<CursorWaitlistEntry[]> {
    return [
      { email: "kai.hartley@wdts.com", displayName: "Kai Hartley", reason: "LOANER_USAGE", position: 1 },
      { email: "tara.singh@wdts.com", displayName: "Tara Singh", reason: "NEW_JOINER", position: 2 },
      { email: "uma.rivera@wdts.com", displayName: "Uma Rivera", reason: "LOANER_USAGE", position: 3 },
      { email: "vince.choi@wdts.com", displayName: "Vince Choi", reason: "NEW_JOINER", position: 4 },
      { email: "will.wang@wdts.com", displayName: "Will Wang", reason: "STEERING_EXCEPTION", position: 5 },
      { email: "yara.tanaka@wdts.com", displayName: "Yara Tanaka", reason: "NEW_JOINER", position: 6 },
      { email: "zane.smith@wdts.com", displayName: "Zane Smith", reason: "LOANER_USAGE", position: 7 },
      { email: "noah.park@wdts.com", displayName: "Noah Park", reason: "NEW_JOINER", position: 8 },
    ];
  },
};
