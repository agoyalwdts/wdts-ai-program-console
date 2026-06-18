import { describe, expect, it } from "vitest";
import {
  mergeUserMtdSpendFromVendors,
  projectUserEom,
  sumUserMtd,
  type UserMtdRow,
} from "./merge-user-mtd-spend";
import type { ProductKey } from "@/lib/program";

describe("sumUserMtd", () => {
  it("sums product rows", () => {
    const map = new Map<ProductKey, UserMtdRow>([
      ["CURSOR", { sum: 10, count: 1 }],
      ["CODEX", { sum: 5, count: 0 }],
    ]);
    expect(sumUserMtd(map)).toBe(15);
  });
});

describe("projectUserEom", () => {
  it("linearly projects from day of month", () => {
    const now = new Date(2026, 5, 18);
    expect(projectUserEom(180, now)).toBeCloseTo(300, 0);
  });
});

describe("mergeUserMtdSpendFromVendors", () => {
  it("merges codex credits into mtd map", async () => {
    const mtdMap = new Map<ProductKey, UserMtdRow>();
    const sources = await mergeUserMtdSpendFromVendors({
      prisma: {
        vendorUserDailySpend: {
          aggregate: async () => ({ _sum: { spendUsd: 0, eventCount: 0 } }),
        },
        programVendorExportSnapshot: { findMany: async () => [] },
      } as never,
      userEmail: "a@wdts.com",
      mtdMap,
      calendarMonthStart: new Date(2026, 5, 1),
      openAiPeriodStart: new Date(2026, 4, 16),
      periodEnd: new Date(2026, 5, 18),
      codexCredits: 10,
    });
    expect(mtdMap.get("CODEX")?.sum).toBeGreaterThan(0);
    expect(sources.CODEX).toBe("vendor");
  });
});
