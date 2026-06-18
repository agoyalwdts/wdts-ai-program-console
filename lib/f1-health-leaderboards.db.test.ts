import { describe, expect, it } from "vitest";
import { Product } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { mirrorTopSpendersByProducts, enrichLeaderboardRows } from "./f1-health-leaderboards";

describe("mirrorTopSpendersByProducts", () => {
  it("returns rows for CURSOR in the last 30 days when seed has data", async () => {
    const now = new Date();
    const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const rows = await mirrorTopSpendersByProducts(prisma, {
      products: [Product.CURSOR],
      periodStart: since,
      periodEnd: now,
      candidateLimit: 20,
    });
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      expect(rows[0]!.userId).toBeTruthy();
      expect(rows[0]!.totalUsd).toBeGreaterThanOrEqual(0);
    }
  });

  it("enrichLeaderboardRows attaches license sub-tier and vs cap for Cursor", async () => {
    const now = new Date();
    const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const top = await mirrorTopSpendersByProducts(prisma, {
      products: [Product.CURSOR],
      periodStart: since,
      periodEnd: now,
      candidateLimit: 5,
    });
    if (top.length === 0) return;

    const rows = await enrichLeaderboardRows(prisma, top.slice(0, 1), {
      products: [Product.CURSOR],
      budgetMonthMultiplier: 1,
    });
    expect(rows.length).toBe(1);
    expect(rows[0]!.subTier).toBeTruthy();
    expect(rows[0]!.capUsdMonth).toBeGreaterThan(0);
    expect(rows[0]!.pctOfCap).not.toBeNull();
  });
});
