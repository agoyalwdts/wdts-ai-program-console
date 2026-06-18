import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { enrichCursorSeatsWithVendorSpend } from "./enrich-cursor-seats-vendor-spend";
import type { CursorSeat } from "./types";

const baseSeat: CursorSeat = {
  userId: "u1",
  email: "dev@wdts.com",
  displayName: "Dev User",
  subTier: "STANDARD",
  lastActivityTs: null,
  idleDays: 999,
  mtdSpendUsd: 0,
};

describe("enrichCursorSeatsWithVendorSpend", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env, INTEGRATION_CURSOR: "real" };
  });

  afterEach(() => {
    process.env = env;
  });

  it("no-ops when INTEGRATION_CURSOR is not real", async () => {
    process.env.INTEGRATION_CURSOR = "synthetic";
    const seats = [baseSeat];
    const out = await enrichCursorSeatsWithVendorSpend({} as never, seats);
    expect(out).toBe(seats);
  });

  it("merges vendor MTD and idle when mirror rows exist", async () => {
    const now = new Date(2026, 5, 18, 15, 0, 0, 0);
    const activityDay = new Date(2026, 5, 10, 12, 0, 0, 0);

    const prisma = {
      vendorUserDailySpend: {
        groupBy: async () => [{ userEmail: "dev@wdts.com", _sum: { spendUsd: 42.5 } }],
        findMany: async () => [{ userEmail: "dev@wdts.com", day: activityDay }],
      },
    };

    const out = await enrichCursorSeatsWithVendorSpend(prisma as never, [baseSeat], now);
    expect(out[0]?.mtdSpendUsd).toBe(42.5);
    expect(out[0]?.lastActivityTs).toEqual(activityDay);
    expect(out[0]?.idleDays).toBe(8);
  });

  it("keeps gateway MTD when it is higher than vendor", async () => {
    const seat: CursorSeat = { ...baseSeat, mtdSpendUsd: 100 };
    const prisma = {
      vendorUserDailySpend: {
        groupBy: async () => [{ userEmail: "dev@wdts.com", _sum: { spendUsd: 40 } }],
        findMany: async () => [],
      },
    };
    const out = await enrichCursorSeatsWithVendorSpend(prisma as never, [seat]);
    expect(out[0]?.mtdSpendUsd).toBe(100);
  });
});
