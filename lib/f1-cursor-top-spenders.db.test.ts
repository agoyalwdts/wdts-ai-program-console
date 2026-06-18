import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { Product } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CURSOR_TEAM_ADMIN_VENDOR_KEY } from "@/lib/integrations/cursor/team-admin-usage";
import { mergeCursorTopSpendersForF1 } from "./f1-cursor-top-spenders";

describe("mergeCursorTopSpendersForF1", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env, INTEGRATION_CURSOR: "real" };
  });

  afterEach(() => {
    process.env = env;
  });

  it("returns gateway top when no vendor user rows exist", async () => {
    const planStart = new Date(2099, 0, 1);
    const planEnd = new Date(2099, 0, 2, 23, 59, 59);
    const { rows, usedVendor } = await mergeCursorTopSpendersForF1(prisma, {
      planPeriodStart: planStart,
      planPeriodEnd: planEnd,
      gatewayTop: [{ userId: "u1", totalUsd: 5, requestCount: 1 }],
      limit: 10,
    });
    expect(usedVendor).toBe(false);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.totalUsd).toBe(5);
  });

  it("prefers vendor per-user totals when rows exist for the period", async () => {
    const user = await prisma.user.findFirst({ select: { id: true, email: true } });
    if (!user) return;

    const day = new Date(2026, 5, 10, 12, 0, 0, 0);
    await prisma.vendorUserDailySpend.create({
      data: {
        vendor: CURSOR_TEAM_ADMIN_VENDOR_KEY,
        product: Product.CURSOR,
        day,
        userEmail: user.email.toLowerCase(),
        spendUsd: 42.5,
        eventCount: 7,
      },
    });

    try {
      const planStart = new Date(2026, 5, 10, 0, 0, 0, 0);
      const planEnd = new Date(2026, 5, 10, 23, 59, 59, 999);
      const { rows, usedVendor } = await mergeCursorTopSpendersForF1(prisma, {
        planPeriodStart: planStart,
        planPeriodEnd: planEnd,
        gatewayTop: [],
        limit: 10,
      });
      expect(usedVendor).toBe(true);
      const hit = rows.find((r) => r.userId === user.id);
      expect(hit?.totalUsd).toBeCloseTo(42.5);
      expect(hit?.requestCount).toBe(7);
    } finally {
      await prisma.vendorUserDailySpend.deleteMany({
        where: {
          vendor: CURSOR_TEAM_ADMIN_VENDOR_KEY,
          product: Product.CURSOR,
          day,
          userEmail: user.email.toLowerCase(),
        },
      });
    }
  });
});
