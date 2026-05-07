/**
 * F9 ladder from Prisma `License` rows (product CODEX) + usage aggregates.
 * Matches synthetic behaviour so real mode shows program tier state, not only
 * OpenAI org membership.
 */

import { prisma } from "@/lib/prisma";
import type { CodexSeat, CodexSubTier } from "./types";

export function licenseSubTierToCodexTier(s: string): CodexSubTier {
  switch (s) {
    case "codex_power":
      return "POWER";
    case "codex_standard":
      return "STANDARD";
    case "codex_light":
      return "LIGHT";
    case "codex_discovery":
      return "DISCOVERY";
    default:
      console.warn(`[openai/codex] unknown License.subTier "${s}", mapping to DISCOVERY`);
      return "DISCOVERY";
  }
}

async function mtdAndLastActivityByUser() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [mtd, last] = await Promise.all([
    prisma.usageRecord.groupBy({
      by: ["userId"],
      where: {
        product: "CODEX",
        ts: { gte: startOfMonth },
        decision: { in: ["ALLOWED", "PROMPTED"] },
      },
      _sum: { costUsd: true },
    }),
    prisma.usageRecord.groupBy({
      by: ["userId"],
      where: { product: "CODEX", decision: { in: ["ALLOWED", "PROMPTED"] } },
      _max: { ts: true },
    }),
  ]);

  return {
    mtdMap: new Map(mtd.map((r) => [r.userId, r._sum.costUsd ?? 0])),
    lastSeenMap: new Map(last.map((r) => [r.userId, r._max.ts ?? null])),
  };
}

export async function listCodexSeatsFromPrisma(): Promise<CodexSeat[]> {
  const [ls, { mtdMap, lastSeenMap }] = await Promise.all([
    prisma.license.findMany({
      where: { product: "CODEX" },
      include: { user: true },
    }),
    mtdAndLastActivityByUser(),
  ]);
  const now = new Date();
  return ls.map((l) => {
    const last = lastSeenMap.get(l.userId) ?? null;
    const idleDays = last
      ? Math.max(
          0,
          Math.floor((now.getTime() - new Date(last).getTime()) / (24 * 60 * 60 * 1000)),
        )
      : null;
    return {
      userId: l.userId,
      email: l.user.email,
      displayName: l.user.displayName,
      subTier: licenseSubTierToCodexTier(l.subTier),
      capUsdMonth: l.capUsdMonth ?? 0,
      mtdSpendUsd: mtdMap.get(l.userId) ?? 0,
      lastActivityTs: last,
      idleDays,
    };
  });
}

/** Recompute MTD / last activity / idle for any Codex seat list (e.g. after org merge). */
export async function enrichCodexSeatsFromUsageRecords(seats: CodexSeat[]): Promise<CodexSeat[]> {
  const { mtdMap, lastSeenMap } = await mtdAndLastActivityByUser();
  const now = new Date();
  return seats.map((s) => {
    const last = lastSeenMap.get(s.userId) ?? null;
    const idleDays = last
      ? Math.max(
          0,
          Math.floor((now.getTime() - new Date(last).getTime()) / (24 * 60 * 60 * 1000)),
        )
      : null;
    return {
      ...s,
      mtdSpendUsd: mtdMap.get(s.userId) ?? 0,
      lastActivityTs: last,
      idleDays,
    };
  });
}
