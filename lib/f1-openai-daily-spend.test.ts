import { describe, expect, it } from "vitest";
import { Product } from "@prisma/client";
import {
  loadOpenAiDailyMergedSpendForF1,
  type OpenAiDailyMergedSpend,
} from "./f1-openai-daily-spend";
import { UNIFIED_CREDITS_VENDOR_KEY } from "@/lib/integrations/unified-credits/constants";
import { WORKSPACE_ANALYTICS_USER_VENDOR_KEY } from "@/lib/integrations/workspace-analytics/vendor-key";
import { CODEX_ENTERPRISE_ANALYTICS_VENDOR_KEY } from "@/lib/integrations/codex-enterprise-analytics/fetch-workspace-usage";

function noonYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

describe("loadOpenAiDailyMergedSpendForF1", () => {
  it("composites unified days with workspace/codex EA for earlier days in the period", async () => {
    const prisma = {
      vendorDailySpend: {
        findMany: async (args: {
          where: { vendor: string; product: Product; day: { gte: Date; lte: Date } };
        }) => {
          const { vendor, product } = args.where;
          if (vendor === UNIFIED_CREDITS_VENDOR_KEY && product === Product.CHATGPT) {
            return [
              { day: noonYmd("2026-06-21"), spendUsd: 10 },
              { day: noonYmd("2026-06-22"), spendUsd: 20 },
            ];
          }
          if (vendor === UNIFIED_CREDITS_VENDOR_KEY && product === Product.CODEX) {
            return [
              { day: noonYmd("2026-06-21"), spendUsd: 30 },
              { day: noonYmd("2026-06-22"), spendUsd: 40 },
            ];
          }
          if (vendor === WORKSPACE_ANALYTICS_USER_VENDOR_KEY) {
            return [
              { day: noonYmd("2026-06-01"), spendUsd: 100 },
              { day: noonYmd("2026-06-15"), spendUsd: 200 },
            ];
          }
          if (vendor === CODEX_ENTERPRISE_ANALYTICS_VENDOR_KEY) {
            return [
              { day: noonYmd("2026-06-01"), spendUsd: 300 },
              { day: noonYmd("2026-06-15"), spendUsd: 400 },
            ];
          }
          return [];
        },
      },
    };

    const periodStart = new Date(2026, 5, 1, 0, 0, 0, 0);
    const periodEnd = new Date(2026, 5, 25, 23, 59, 59, 999);

    const full = await loadOpenAiDailyMergedSpendForF1(prisma as never, {
      periodStart,
      periodEnd,
      env: {
        INTEGRATION_OPENAI: "real",
        INTEGRATION_CODEX_ENTERPRISE_ANALYTICS: "real",
        INTEGRATION_OPENAI_COMPLIANCE: "real",
      },
    });

    const shortStart = new Date(2026, 5, 16, 0, 0, 0, 0);
    const short = await loadOpenAiDailyMergedSpendForF1(prisma as never, {
      periodStart: shortStart,
      periodEnd,
      env: {
        INTEGRATION_OPENAI: "real",
        INTEGRATION_CODEX_ENTERPRISE_ANALYTICS: "real",
        INTEGRATION_OPENAI_COMPLIANCE: "real",
      },
    });

    expect(full.chatgpt.periodTotalUsd).toBeGreaterThan(short.chatgpt.periodTotalUsd);
    expect(full.codex.periodTotalUsd).toBeGreaterThan(short.codex.periodTotalUsd);
    expect(short.chatgpt.periodTotalUsd).toBe(30);
    expect(short.codex.periodTotalUsd).toBe(70);
    expect(full.chatgpt.periodTotalUsd).toBe(330);
    expect(full.codex.periodTotalUsd).toBe(770);
  });
});

describe("mergeProductDaily via loadOpenAiDailyMergedSpendForF1", () => {
  it("returns zero when period start is after end", async () => {
    const merged: OpenAiDailyMergedSpend = await loadOpenAiDailyMergedSpendForF1(
      { vendorDailySpend: { findMany: async () => [] } } as never,
      {
        periodStart: new Date(2026, 5, 20),
        periodEnd: new Date(2026, 5, 10),
      },
    );
    expect(merged.chatgpt.periodTotalUsd).toBe(0);
    expect(merged.codex.periodTotalUsd).toBe(0);
  });
});
