import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { Product } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CURSOR_TEAM_ADMIN_VENDOR_KEY } from "@/lib/integrations/cursor/team-admin-usage";
import { UNIFIED_CREDITS_VENDOR_KEY } from "@/lib/integrations/unified-credits/constants";
import {
  aggregateChargebackSpendByUserId,
  totalSpendForUser,
} from "./aggregate-user-spend";

describe("aggregateChargebackSpendByUserId", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env, INTEGRATION_CURSOR: "real" };
  });

  afterEach(() => {
    process.env = env;
  });

  it("prefers Cursor vendor spend over gateway for the same user", async () => {
    const user = await prisma.user.findFirst({ select: { id: true, email: true } });
    if (!user) return;

    const day = new Date(2099, 0, 15, 12, 0, 0, 0);
    await prisma.vendorUserDailySpend.create({
      data: {
        vendor: CURSOR_TEAM_ADMIN_VENDOR_KEY,
        product: Product.CURSOR,
        day,
        userEmail: user.email.toLowerCase(),
        spendUsd: 88,
        eventCount: 3,
      },
    });

    try {
      const periodStart = new Date(2099, 0, 1);
      const periodEnd = new Date(2099, 0, 31);
      const emailToUserId = new Map([[user.email.toLowerCase(), user.id]]);
      const { spendByUserId, meta } = await aggregateChargebackSpendByUserId({
        prisma,
        gatewayAggs: [
          {
            userId: user.id,
            product: "CURSOR",
            periodStart,
            periodEnd,
            totalUsd: 5,
            requestCount: 1,
          },
        ],
        emailToUserId,
        periodStart,
        periodEnd,
      });

      const row = spendByUserId.get(user.id);
      expect(row?.CURSOR).toBeCloseTo(88);
      expect(totalSpendForUser(row!)).toBeGreaterThan(5);
      expect(meta.usedVendorMirror).toBe(true);
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

  it("includes Unified Credits vendor rows when present", async () => {
    const user = await prisma.user.findFirst({ select: { id: true, email: true } });
    if (!user) return;

    const day = new Date(2099, 1, 10, 12, 0, 0, 0);
    await prisma.vendorUserDailySpend.create({
      data: {
        vendor: UNIFIED_CREDITS_VENDOR_KEY,
        product: Product.CHATGPT,
        day,
        userEmail: user.email.toLowerCase(),
        spendUsd: 12.5,
        eventCount: 1,
      },
    });

    try {
      const periodStart = new Date(2099, 1, 1);
      const periodEnd = new Date(2099, 1, 28);
      const { spendByUserId } = await aggregateChargebackSpendByUserId({
        prisma,
        gatewayAggs: [],
        emailToUserId: new Map([[user.email.toLowerCase(), user.id]]),
        periodStart,
        periodEnd,
      });
      expect(spendByUserId.get(user.id)?.CHATGPT).toBeCloseTo(12.5);
    } finally {
      await prisma.vendorUserDailySpend.deleteMany({
        where: {
          vendor: UNIFIED_CREDITS_VENDOR_KEY,
          product: Product.CHATGPT,
          day,
          userEmail: user.email.toLowerCase(),
        },
      });
    }
  });
});
