/**
 * Postgres-backed GatewayClient — reads `UsageRecord` rows from Prisma.
 *
 * Used for both `INTEGRATION_GATEWAY=synthetic` (seed data) and
 * `INTEGRATION_GATEWAY=real` (production mirror). The difference is
 * operational: in real mode you populate rows via the HMAC webhook
 * `POST /api/webhooks/usage-ingest` (or a future vendor pull job), then
 * F1/F2/F3 consumers that call `getGatewayClient()` see live data.
 *
 * When a vendor HTTP audit API is wired, this module may split into
 * `real.ts` (remote fetch) + keep a read-through cache in Postgres.
 */

import { prisma } from "@/lib/prisma";
import { PRODUCTS, type ProductKey } from "@/lib/program";
import type {
  DailyProgramAggregate,
  GatewayClient,
  ManagerQueueRow,
  ProgramAggregate,
  TopSpender,
  UsageAggregate,
  UsageDecision,
  UsageRecord,
} from "./types";

const PRODUCT_KEYS = PRODUCTS.map((p) => p.key);
const PRODUCT_KEY_SET = new Set<string>(PRODUCT_KEYS);

function asProductKey(p: string): ProductKey {
  if (!PRODUCT_KEY_SET.has(p)) throw new Error(`Unknown product key from DB: ${p}`);
  return p as ProductKey;
}

function asUsageDecision(d: string): UsageDecision {
  switch (d) {
    case "ALLOWED":
    case "PROMPTED":
    case "BLOCKED":
    case "DOWNGRADED":
      return d;
    default:
      throw new Error(`Unknown usage decision from DB: ${d}`);
  }
}

export const postgresMirrorGatewayClient: GatewayClient = {
  async listUsageRecords({ userId, since, until, product, limit }) {
    const cap = Math.min(limit ?? 200, 1000);
    const rows = await prisma.usageRecord.findMany({
      where: {
        userId,
        ts: { gte: since, lte: until ?? new Date() },
        ...(product ? { product } : {}),
      },
      orderBy: { ts: "desc" },
      take: cap,
    });
    return rows.map<UsageRecord>((r) => ({
      userId: r.userId,
      product: asProductKey(r.product),
      model: r.model,
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
      costUsd: r.costUsd,
      decision: asUsageDecision(r.decision),
      region: r.region,
      ts: r.ts,
    }));
  },

  async aggregateByUser({ userIds, periodStart, periodEnd }) {
    const grouped = await prisma.usageRecord.groupBy({
      by: ["userId", "product"],
      where: {
        ts: { gte: periodStart, lte: periodEnd },
        ...(userIds && userIds.length > 0 ? { userId: { in: userIds } } : {}),
      },
      _sum: { costUsd: true },
      _count: { _all: true },
    });
    return grouped.map<UsageAggregate>((g) => ({
      userId: g.userId,
      product: asProductKey(g.product),
      periodStart,
      periodEnd,
      totalUsd: g._sum.costUsd ?? 0,
      requestCount: g._count._all,
    }));
  },

  async aggregateByProgram({ periodStart, periodEnd }) {
    const grouped = await prisma.usageRecord.groupBy({
      by: ["product"],
      where: { ts: { gte: periodStart, lte: periodEnd } },
      _sum: { costUsd: true },
      _count: { _all: true },
    });
    return grouped.map<ProgramAggregate>((g) => ({
      product: asProductKey(g.product),
      periodStart,
      periodEnd,
      totalUsd: g._sum.costUsd ?? 0,
      requestCount: g._count._all,
    }));
  },

  async aggregateByProgramDaily({ since, until }) {
    const upper = until ?? new Date();
    const rows = await prisma.usageRecord.findMany({
      where: { ts: { gte: since, lte: upper } },
      select: { product: true, costUsd: true, ts: true },
    });

    const days: DailyProgramAggregate[] = [];
    const dayKey = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
    const startCursor = new Date(since);
    startCursor.setHours(0, 0, 0, 0);
    const endCursor = new Date(upper);
    endCursor.setHours(0, 0, 0, 0);
    for (
      let d = new Date(startCursor);
      d.getTime() <= endCursor.getTime();
      d.setDate(d.getDate() + 1)
    ) {
      const empty = {} as Record<ProductKey, number>;
      for (const p of PRODUCTS) empty[p.key] = 0;
      days.push({ day: dayKey(d), byProduct: empty });
    }
    const idx = new Map(days.map((d, i) => [d.day, i]));

    for (const r of rows) {
      const k = dayKey(new Date(r.ts));
      const i = idx.get(k);
      if (i == null) continue;
      const p = asProductKey(r.product);
      days[i]!.byProduct[p] += r.costUsd ?? 0;
    }
    return days;
  },

  async topSpenders({ periodStart, periodEnd, limit }) {
    const rows = await prisma.usageRecord.groupBy({
      by: ["userId"],
      where: { ts: { gte: periodStart, lte: periodEnd } },
      _sum: { costUsd: true },
      _count: { _all: true },
      orderBy: { _sum: { costUsd: "desc" } },
      take: Math.max(1, Math.min(limit ?? 10, 100)),
    });
    return rows.map<TopSpender>((r) => ({
      userId: r.userId,
      totalUsd: r._sum.costUsd ?? 0,
      requestCount: r._count._all,
    }));
  },

  async managerQueue({ managerUserId }) {
    const reports = await prisma.user.findMany({
      where: { managerId: managerUserId },
      include: {
        licenses: true,
        usageRecords: {
          where: { decision: "ALLOWED" },
          orderBy: { ts: "desc" },
          take: 1,
        },
      },
    });
    if (reports.length === 0) return [];

    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const reportIds = reports.map((r) => r.id);
    const mtdAggs = await prisma.usageRecord.groupBy({
      by: ["userId", "product"],
      where: { userId: { in: reportIds }, ts: { gte: monthStart, lte: now } },
      _sum: { costUsd: true },
    });

    const aggByUser = new Map<string, Map<ProductKey, number>>();
    for (const a of mtdAggs) {
      const m = aggByUser.get(a.userId) ?? new Map<ProductKey, number>();
      m.set(asProductKey(a.product), a._sum.costUsd ?? 0);
      aggByUser.set(a.userId, m);
    }

    const rows: ManagerQueueRow[] = reports.map((r) => {
      const spendByProduct = aggByUser.get(r.id) ?? new Map<ProductKey, number>();
      const cap = {} as Record<ProductKey, number | null>;
      for (const key of PRODUCT_KEYS) {
        const lic = r.licenses.find((l) => l.product === key);
        const spent = spendByProduct.get(key) ?? 0;
        if (!lic || lic.capUsdMonth == null || lic.capUsdMonth === 0) {
          cap[key] = lic ? null : null;
        } else {
          cap[key] = spent / lic.capUsdMonth;
        }
      }
      const lastTs = r.usageRecords[0]?.ts ?? null;
      const idleDays = lastTs
        ? Math.floor((now.getTime() - lastTs.getTime()) / (24 * 60 * 60 * 1000))
        : null;
      let mtdSpend = 0;
      for (const v of spendByProduct.values()) mtdSpend += v;
      return {
        userId: r.id,
        email: r.email,
        displayName: r.displayName,
        capUtilisation: cap,
        idleDays,
        mtdSpendUsd: mtdSpend,
      };
    });

    return rows;
  },
};
