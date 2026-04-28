/**
 * Integration tests for the synthetic GatewayClient against the seeded
 * test DB.
 *
 * The deterministic seed loads 30 users / 103 licences / 3760 usage records
 * / 10 decisions; these tests assert against those fixed shapes.
 *
 * Read-only — see tests/db-utils.ts for why writes from tests aren't safe.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { syntheticGatewayClient } from "./synthetic";
import { prisma } from "@/lib/prisma";
import { PRODUCTS } from "@/lib/program";

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("syntheticGatewayClient (DB-integration)", () => {
  it("aggregateByProgram returns one row per product the seed populates", async () => {
    const now = new Date();
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const rows = await syntheticGatewayClient.aggregateByProgram({
      periodStart: start,
      periodEnd: now,
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(PRODUCTS.length);

    for (const r of rows) {
      expect(r.totalUsd).toBeGreaterThanOrEqual(0);
      expect(r.requestCount).toBeGreaterThan(0);
      expect(PRODUCTS.map((p) => p.key)).toContain(r.product);
    }

    // Aggregate spend across products is positive and roughly within the
    // ballpark the seed produces (single-digit thousand $ for 30 users / 30
    // days). Loose bounds — they're a regression net, not a budget claim.
    const total = rows.reduce((s, r) => s + r.totalUsd, 0);
    expect(total).toBeGreaterThan(100);
    expect(total).toBeLessThan(50_000);
  });

  it("aggregateByProgramDaily returns one row per calendar day in the window", async () => {
    const now = new Date();
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const rows = await syntheticGatewayClient.aggregateByProgramDaily({
      since: start,
      until: now,
    });
    // 8 calendar days inclusive (today + last 7).
    expect(rows.length).toBe(8);
    for (const r of rows) {
      expect(typeof r.day).toBe("string");
      for (const p of PRODUCTS) expect(r.byProduct[p.key]).toBeGreaterThanOrEqual(0);
    }
  });

  it("topSpenders is sorted by totalUsd descending and capped to limit", async () => {
    const now = new Date();
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const rows = await syntheticGatewayClient.topSpenders({
      periodStart: start,
      periodEnd: now,
      limit: 5,
    });
    expect(rows.length).toBeLessThanOrEqual(5);
    expect(rows.length).toBeGreaterThan(0);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.totalUsd).toBeGreaterThanOrEqual(rows[i]!.totalUsd);
    }
    // Each row points at a real seeded user.
    const userIds = rows.map((r) => r.userId);
    const found = await prisma.user.count({ where: { id: { in: userIds } } });
    expect(found).toBe(rows.length);
  });

  it("listUsageRecords respects userId, since, and limit", async () => {
    const someUser = await prisma.user.findFirst({
      where: { usageRecords: { some: {} } },
    });
    expect(someUser).toBeTruthy();
    if (!someUser) return;

    const now = new Date();
    const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const rows = await syntheticGatewayClient.listUsageRecords({
      userId: someUser.id,
      since,
      limit: 5,
    });
    expect(rows.length).toBeLessThanOrEqual(5);
    for (const r of rows) {
      expect(r.userId).toBe(someUser.id);
      expect(r.ts.getTime()).toBeGreaterThanOrEqual(since.getTime());
    }
    // Ordering: descending by timestamp.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.ts.getTime()).toBeGreaterThanOrEqual(rows[i]!.ts.getTime());
    }
  });

  it("managerQueue returns one row per direct report, with cap utilisation per product", async () => {
    const manager = await prisma.user.findFirst({ where: { reports: { some: {} } } });
    expect(manager).toBeTruthy();
    if (!manager) return;

    const expectedReports = await prisma.user.count({
      where: { managerId: manager.id },
    });

    const rows = await syntheticGatewayClient.managerQueue({
      managerUserId: manager.id,
    });
    expect(rows).toHaveLength(expectedReports);
    for (const r of rows) {
      // Cap utilisation has a key for every product (some may be null).
      for (const p of PRODUCTS) {
        expect(Object.prototype.hasOwnProperty.call(r.capUtilisation, p.key)).toBe(true);
      }
      expect(r.mtdSpendUsd).toBeGreaterThanOrEqual(0);
    }
  });
});
