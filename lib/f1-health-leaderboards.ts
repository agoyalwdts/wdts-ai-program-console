/**
 * F1 per-product leaderboards from the gateway mirror (`UsageRecord` in Postgres).
 * Vendor program totals (Cursor Team Admin, OpenAI org costs) stay day-level only;
 * per-user Cursor/OpenAI org attribution would need a new store — see health page copy.
 */

import type { PrismaClient } from "@prisma/client";
import { Product } from "@prisma/client";
import type { TopSpender } from "@/lib/integrations/gateway/types";

export async function mirrorTopSpendersByProducts(
  prisma: PrismaClient,
  args: {
    products: Product[];
    periodStart: Date;
    periodEnd: Date;
    /** Fetch enough rows before CSV merge caps the final list. */
    candidateLimit: number;
  },
): Promise<TopSpender[]> {
  const { products, periodStart, periodEnd, candidateLimit } = args;
  if (products.length === 0) return [];

  const take = Math.max(10, Math.min(candidateLimit, 200));
  const rows = await prisma.usageRecord.groupBy({
    by: ["userId"],
    where: {
      product: { in: products },
      ts: { gte: periodStart, lte: periodEnd },
    },
    _sum: { costUsd: true },
    _count: { _all: true },
    orderBy: { _sum: { costUsd: "desc" } },
    take,
  });

  return rows.map((r) => ({
    userId: r.userId,
    totalUsd: r._sum.costUsd ?? 0,
    requestCount: r._count._all,
  }));
}

export type F1LeaderboardRow = {
  id: string;
  displayName: string;
  email: string;
  roleTag: string;
  region: string;
  total: number;
};

export async function enrichLeaderboardRows(
  prisma: PrismaClient,
  rows: TopSpender[],
  deelByEmail: Map<string, { roleTag?: string | null; region?: string | null }>,
): Promise<F1LeaderboardRow[]> {
  const ids = rows.map((r) => r.userId);
  if (ids.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, displayName: true, email: true, roleTag: true, region: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  const out: F1LeaderboardRow[] = [];
  for (const r of rows) {
    const u = userById.get(r.userId);
    if (!u) continue;
    const hr = deelByEmail.get(u.email);
    out.push({
      id: r.userId,
      displayName: u.displayName,
      email: u.email,
      roleTag: hr?.roleTag ?? u.roleTag ?? "—",
      region: hr?.region ?? u.region ?? "—",
      total: r.totalUsd,
    });
  }
  return out;
}
