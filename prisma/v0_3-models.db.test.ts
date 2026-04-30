/**
 * DB-integration tests for the four v0.3 models added in the
 * `20260429_v0_3_schema` migration (per ADR 0001):
 *
 *   - ExceptionRequest
 *   - ReclamationEvent
 *   - BudgetSnapshot
 *   - FrictionBudgetMetric
 *
 * Read-only — see tests/db-utils.ts for why writes from tests aren't safe.
 *
 * These tests intentionally assert against the **seeded** shape (count
 * + distribution of statuses / states), not against business logic that
 * doesn't exist yet (F6–F8 land in the next PR). The point is to:
 *
 *   - Verify the migration ran cleanly against the test DB (otherwise
 *     prisma.exceptionRequest.* would be undefined / blow up).
 *   - Verify the seed populates each table with the expected variety
 *     (so a regression that drops a state from the lifecycle gets
 *     caught here, not three weeks later when F8 ships).
 *   - Lock in the FK shape so a refactor that breaks a relation surfaces
 *     immediately.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  ExceptionStatus,
  ExceptionType,
  Product,
  ReclamationAction,
  ReclamationState,
  ReclamationTrigger,
} from "@prisma/client";

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("ExceptionRequest (DB-integration)", () => {
  it("seed inserts three rows with distinct lifecycle states", async () => {
    const all = await prisma.exceptionRequest.findMany({
      include: { subject: true },
      orderBy: { createdAt: "asc" },
    });
    expect(all).toHaveLength(3);

    const statuses = all.map((r) => r.status).sort();
    expect(statuses).toEqual(
      [
        ExceptionStatus.APPROVED,
        ExceptionStatus.SUBMITTED,
        ExceptionStatus.UNDER_REVIEW,
      ].sort(),
    );

    // Every row points at a real User.
    for (const r of all) {
      expect(r.subject).toBeTruthy();
      expect(r.subject.id).toBe(r.subjectUserId);
    }

    // The APPROVED row has a TTL + computed expiresAt; the SUBMITTED
    // row has neither yet.
    const approved = all.find((r) => r.status === ExceptionStatus.APPROVED);
    expect(approved?.ttlDays).toBe(30);
    expect(approved?.expiresAt).toBeTruthy();
    expect(approved?.approvedAt).toBeTruthy();

    const submitted = all.find((r) => r.status === ExceptionStatus.SUBMITTED);
    expect(submitted?.attestedAt).toBeNull();
    expect(submitted?.reviewedAt).toBeNull();
    expect(submitted?.approvedAt).toBeNull();
  });

  it("effectChange round-trips as JSON-as-string", async () => {
    const approved = await prisma.exceptionRequest.findFirst({
      where: { status: ExceptionStatus.APPROVED },
    });
    expect(approved).toBeTruthy();
    if (!approved) return;
    const parsed = JSON.parse(approved.effectChange) as {
      capUsdMonth?: number;
    };
    expect(parsed.capUsdMonth).toBe(200);
  });

  it("type uses the ExceptionType enum at the DB level", async () => {
    const types = await prisma.exceptionRequest.groupBy({
      by: ["type"],
      _count: { _all: true },
    });
    const seen = new Set(types.map((t) => t.type));
    expect(seen.size).toBeGreaterThan(0);
    for (const t of seen) {
      expect(Object.values(ExceptionType)).toContain(t);
    }
  });
});

describe("ReclamationEvent (DB-integration)", () => {
  it("seed inserts two rows: one resolved, one in active dispute window", async () => {
    const all = await prisma.reclamationEvent.findMany({
      orderBy: { triggeredAt: "asc" },
    });
    expect(all).toHaveLength(2);

    const resolved = all.find(
      (r) => r.state === ReclamationState.RESOLVED_RECLAIMED,
    );
    expect(resolved).toBeTruthy();
    expect(resolved?.action).toBe(ReclamationAction.RECLAIM);
    expect(resolved?.resolvedAt).toBeTruthy();

    const open = all.find((r) => r.state === ReclamationState.NOTIFIED);
    expect(open).toBeTruthy();
    expect(open?.action).toBe(ReclamationAction.NOTIFY);
    expect(open?.disputeWindowEndsAt).toBeTruthy();
    // The open row's dispute window is in the future.
    expect(open!.disputeWindowEndsAt!.getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it("trigger uses the ReclamationTrigger enum at the DB level", async () => {
    const triggers = await prisma.reclamationEvent.findMany({
      select: { trigger: true },
    });
    for (const t of triggers) {
      expect(Object.values(ReclamationTrigger)).toContain(t.trigger);
    }
  });

  it("subjectUserId resolves to a real User row", async () => {
    const events = await prisma.reclamationEvent.findMany({
      include: { subject: true },
    });
    for (const e of events) {
      expect(e.subject).toBeTruthy();
      expect(e.subject.id).toBe(e.subjectUserId);
    }
  });
});

describe("BudgetSnapshot (DB-integration)", () => {
  it("seed inserts one row per (product, sub-tier, period) for two months", async () => {
    const rows = await prisma.budgetSnapshot.findMany();
    // 9 sub-tier shapes × 2 months = 18 rows.
    expect(rows).toHaveLength(18);

    // Unique-key constraint on (product, subTier, periodStart) honoured.
    const keys = new Set(
      rows.map((r) => `${r.product}|${r.subTier}|${r.periodStart.toISOString()}`),
    );
    expect(keys.size).toBe(rows.length);

    for (const r of rows) {
      expect(Object.values(Product)).toContain(r.product);
      expect(r.totalUsd).toBeGreaterThanOrEqual(0);
      expect(r.requestCount).toBeGreaterThanOrEqual(0);
      expect(r.userCount).toBeGreaterThan(0);
      expect(r.periodEnd.getTime()).toBeGreaterThan(r.periodStart.getTime());
    }
  });

  it("seat-priced products carry null capUsdMonth + null pctOfCap", async () => {
    const copilotRows = await prisma.budgetSnapshot.findMany({
      where: { product: Product.M365_COPILOT },
    });
    expect(copilotRows.length).toBeGreaterThan(0);
    for (const r of copilotRows) {
      expect(r.capUsdMonth).toBeNull();
      expect(r.pctOfCap).toBeNull();
    }
  });
});

describe("FrictionBudgetMetric (DB-integration)", () => {
  it("seed inserts 4 weeks × 6 buckets = 24 rows", async () => {
    const rows = await prisma.frictionBudgetMetric.findMany();
    // Cross-product (product=null) + one per Product enum value × 4 weeks.
    expect(rows).toHaveLength(24);
  });

  it("counters add up: allowed + prompted + blocked + downgraded == totalRequests", async () => {
    const rows = await prisma.frictionBudgetMetric.findMany();
    for (const r of rows) {
      expect(
        r.allowed + r.prompted + r.blocked + r.downgraded,
      ).toBe(r.totalRequests);
    }
  });

  it("frictionRate matches (blocked + downgraded) / totalRequests within float epsilon", async () => {
    const rows = await prisma.frictionBudgetMetric.findMany();
    for (const r of rows) {
      const expected = (r.blocked + r.downgraded) / r.totalRequests;
      expect(Math.abs(r.frictionRate - expected)).toBeLessThan(1e-9);
    }
  });

  it("product field accepts null (cross-product aggregate)", async () => {
    const crossProduct = await prisma.frictionBudgetMetric.findMany({
      where: { product: null },
    });
    // 1 cross-product row × 4 weeks = 4.
    expect(crossProduct).toHaveLength(4);
  });
});
