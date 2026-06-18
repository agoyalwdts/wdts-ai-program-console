/**
 * F1 per-product leaderboards from the gateway mirror (`UsageRecord` in Postgres)
 * and vendor per-user attribution (Cursor Team Admin, ChatGPT/Codex CSV).
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
  /** License sub-tier label(s) for the leaderboard product scope. */
  subTier: string | null;
  capUsdMonth: number | null;
  periodCapUsd: number | null;
  pctOfCap: number | null;
  total: number;
};

export function computeLeaderboardPctOfCap(args: {
  periodSpendUsd: number;
  capUsdMonth: number | null;
  budgetMonthMultiplier: number;
}): { periodCapUsd: number | null; pctOfCap: number | null } {
  if (args.capUsdMonth == null || args.capUsdMonth <= 0) {
    return { periodCapUsd: null, pctOfCap: null };
  }
  const periodCapUsd = args.capUsdMonth * Math.max(0, args.budgetMonthMultiplier);
  if (periodCapUsd <= 0) {
    return { periodCapUsd: null, pctOfCap: null };
  }
  return {
    periodCapUsd,
    pctOfCap: (args.periodSpendUsd / periodCapUsd) * 100,
  };
}

function formatLicenseSubTier(product: Product, subTier: string): string {
  if (product === Product.CODEX) return `Codex · ${subTier}`;
  if (product === Product.CHATGPT) return `ChatGPT · ${subTier}`;
  if (product === Product.CURSOR) return subTier.replace(/^cursor_/, "");
  return subTier;
}

function aggregateLicenseCaps(
  licenses: { product: Product; subTier: string; capUsdMonth: number | null }[],
): { subTier: string | null; capUsdMonth: number | null } {
  if (licenses.length === 0) {
    return { subTier: null, capUsdMonth: null };
  }
  const subTier = licenses
    .map((l) => formatLicenseSubTier(l.product, l.subTier))
    .join(" · ");
  let capSum = 0;
  let hasCap = false;
  for (const l of licenses) {
    if (l.capUsdMonth != null && l.capUsdMonth > 0) {
      capSum += l.capUsdMonth;
      hasCap = true;
    }
  }
  return { subTier, capUsdMonth: hasCap ? capSum : null };
}

export async function enrichLeaderboardRows(
  prisma: PrismaClient,
  rows: TopSpender[],
  args: {
    products: Product[];
    budgetMonthMultiplier: number;
  },
): Promise<F1LeaderboardRow[]> {
  const ids = rows.map((r) => r.userId);
  if (ids.length === 0) return [];

  const productSet = new Set(args.products);

  const [users, licenses] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, displayName: true, email: true },
    }),
    prisma.license.findMany({
      where: {
        userId: { in: ids },
        product: { in: args.products },
      },
      select: { userId: true, product: true, subTier: true, capUsdMonth: true },
    }),
  ]);

  const userById = new Map(users.map((u) => [u.id, u]));
  const licensesByUser = new Map<string, { product: Product; subTier: string; capUsdMonth: number | null }[]>();
  for (const lic of licenses) {
    if (!productSet.has(lic.product)) continue;
    const list = licensesByUser.get(lic.userId) ?? [];
    list.push(lic);
    licensesByUser.set(lic.userId, list);
  }

  const out: F1LeaderboardRow[] = [];
  for (const r of rows) {
    const u = userById.get(r.userId);
    if (!u) continue;
    const userLicenses = licensesByUser.get(r.userId) ?? [];
    userLicenses.sort((a, b) => a.product.localeCompare(b.product));
    const { subTier, capUsdMonth } = aggregateLicenseCaps(userLicenses);
    const { periodCapUsd, pctOfCap } = computeLeaderboardPctOfCap({
      periodSpendUsd: r.totalUsd,
      capUsdMonth,
      budgetMonthMultiplier: args.budgetMonthMultiplier,
    });
    out.push({
      id: r.userId,
      displayName: u.displayName,
      email: u.email,
      subTier,
      capUsdMonth,
      periodCapUsd,
      pctOfCap,
      total: r.totalUsd,
    });
  }
  return out;
}
