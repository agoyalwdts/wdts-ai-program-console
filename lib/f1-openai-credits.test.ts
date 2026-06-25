import { describe, expect, it } from "vitest";
import { resolveOpenAiF1Credits, resolveOpenAiCreditsFromDailyMerge, resolveOpenAiF1CreditsFromMerged } from "./f1-openai-credits";
import type { OpenAiDailyMergedSpend } from "./f1-openai-daily-spend";


describe("resolveOpenAiF1Credits", () => {
  const noUnified = {
    unifiedChatgptUsed: false,
    unifiedChatgptUsd: 0,
    unifiedCodexUsed: false,
    unifiedCodexUsd: 0,
  };

  it("subtracts Codex from org pool when vendorMirrorCompositeUsed (fallback path)", () => {
    const poolUsd = 1_000_000 * 0.07;
    const codexUsd = 300_000 * 0.07;
    const r = resolveOpenAiF1Credits({
      chatgptUsd: poolUsd,
      codexUsd,
      budgetMonthMultiplier: 1,
      workspaceChatgptUsed: true,
      workspaceChatgptUsd: poolUsd,
      manualChatgptUsed: false,
      manualChatgptUsd: 0,
      codexEnterpriseUsed: true,
      codexEnterpriseUsd: codexUsd,
      unifiedChatgptUsed: false,
      unifiedChatgptUsd: 0,
      unifiedCodexUsed: false,
      unifiedCodexUsd: 0,
      vendorMirrorCompositeUsed: true,
    });
    expect(r.mode).toBe("direct");
    expect(r.combinedCredits).toBeCloseTo(1_000_000, 0);
    expect(r.codexCredits).toBeCloseTo(300_000, 0);
    expect(r.chatgptCredits).toBeCloseTo(700_000, 0);
  });

  it("uses Unified Credits COSTS product slices when synced (legacy whole-period path)", () => {
    const r = resolveOpenAiF1Credits({
      chatgptUsd: 999,
      codexUsd: 999,
      budgetMonthMultiplier: 1,
      workspaceChatgptUsed: true,
      workspaceChatgptUsd: 999,
      manualChatgptUsed: false,
      manualChatgptUsd: 0,
      codexEnterpriseUsed: true,
      codexEnterpriseUsd: 999,
      unifiedChatgptUsed: true,
      unifiedChatgptUsd: 700_000 * 0.07,
      unifiedCodexUsed: true,
      unifiedCodexUsd: 300_000 * 0.07,
    });
    expect(r.mode).toBe("direct");
    expect(r.chatgptCredits).toBeCloseTo(700_000, 0);
    expect(r.codexCredits).toBeCloseTo(300_000, 0);
    expect(r.combinedCredits).toBeCloseTo(1_000_000, 0);
  });

  it("subtracts Codex from org-pool Workspace Analytics credits for ChatGPT tile", () => {
    // Pool = 1M credits @ $0.07; Codex = 300k credits @ $0.07
    const poolUsd = 1_000_000 * 0.07;
    const codexUsd = 300_000 * 0.07;
    const r = resolveOpenAiF1Credits({
      chatgptUsd: poolUsd,
      codexUsd,
      budgetMonthMultiplier: 1,
      workspaceChatgptUsed: true,
      workspaceChatgptUsd: poolUsd,
      manualChatgptUsed: false,
      manualChatgptUsd: 0,
      codexEnterpriseUsed: true,
      codexEnterpriseUsd: codexUsd,
      ...noUnified,
    });
    expect(r.mode).toBe("direct");
    expect(r.combinedCredits).toBeCloseTo(1_000_000, 0);
    expect(r.codexCredits).toBeCloseTo(300_000, 0);
    expect(r.chatgptCredits).toBeCloseTo(700_000, 0);
  });

  it("uses org pool alone when Codex vendor is absent", () => {
    const poolUsd = 500_000 * 0.07;
    const r = resolveOpenAiF1Credits({
      chatgptUsd: poolUsd,
      codexUsd: 0,
      budgetMonthMultiplier: 1,
      workspaceChatgptUsed: true,
      workspaceChatgptUsd: poolUsd,
      manualChatgptUsed: false,
      manualChatgptUsd: 0,
      codexEnterpriseUsed: false,
      codexEnterpriseUsd: 0,
      ...noUnified,
    });
    expect(r.chatgptCredits).toBeCloseTo(500_000, 0);
    expect(r.codexCredits).toBe(0);
    expect(r.combinedCredits).toBeCloseTo(500_000, 0);
  });
});

describe("resolveOpenAiCreditsFromDailyMerge", () => {
  function emptySeries() {
    return {
      periodTotalUsd: 0,
      byChartDay: new Map<string, number>(),
      byYmd: new Map<string, number>(),
      byYmdSource: new Map<string, string>(),
      usedVendorMirror: false,
      dominantSource: "gateway" as const,
    };
  }

  it("subtracts Codex from Workspace Analytics org pool per day (prod-shaped)", () => {
    const poolUsd = 30_455.6;
    const codexUsd = 28_175.91;
    const merged: OpenAiDailyMergedSpend = {
      chatgpt: {
        ...emptySeries(),
        periodTotalUsd: poolUsd,
        usedVendorMirror: true,
        dominantSource: "workspace_analytics",
        byYmd: new Map([["2026-05-28", poolUsd]]),
        byYmdSource: new Map([["2026-05-28", "workspace_analytics"]]),
      },
      codex: {
        ...emptySeries(),
        periodTotalUsd: codexUsd,
        usedVendorMirror: true,
        dominantSource: "codex_enterprise_analytics_sync",
        byYmd: new Map([["2026-05-28", codexUsd]]),
        byYmdSource: new Map([["2026-05-28", "codex_enterprise_analytics_sync"]]),
      },
    };

    const r = resolveOpenAiCreditsFromDailyMerge({
      merged,
      periodStart: new Date(2026, 4, 28),
      periodEnd: new Date(2026, 4, 28, 23, 59, 59),
    });

    expect(r.combinedCredits).toBeCloseTo(435_080, 0);
    expect(r.codexCredits).toBeCloseTo(402_513, 0);
    expect(r.chatgptCredits).toBeCloseTo(32_567, 0);
  });

  it("uses explicit product slices on unified-credits days", () => {
    const merged: OpenAiDailyMergedSpend = {
      chatgpt: {
        ...emptySeries(),
        periodTotalUsd: 700,
        usedVendorMirror: true,
        dominantSource: "unified_credits",
        byYmd: new Map([["2026-06-21", 700]]),
        byYmdSource: new Map([["2026-06-21", "unified_credits"]]),
      },
      codex: {
        ...emptySeries(),
        periodTotalUsd: 300,
        usedVendorMirror: true,
        dominantSource: "unified_credits",
        byYmd: new Map([["2026-06-21", 300]]),
        byYmdSource: new Map([["2026-06-21", "unified_credits"]]),
      },
    };

    const r = resolveOpenAiCreditsFromDailyMerge({
      merged,
      periodStart: new Date(2026, 5, 21),
      periodEnd: new Date(2026, 5, 21, 23, 59, 59),
    });

    expect(r.chatgptCredits).toBeCloseTo(10_000, 0);
    expect(r.codexCredits).toBeCloseTo(4_285.7, 0);
    expect(r.combinedCredits).toBeCloseTo(14_285.7, 0);
  });
});

describe("resolveOpenAiF1CreditsFromMerged", () => {
  function emptySeries() {
    return {
      periodTotalUsd: 0,
      byChartDay: new Map<string, number>(),
      byYmd: new Map<string, number>(),
      byYmdSource: new Map<string, string>(),
      usedVendorMirror: false,
      dominantSource: "gateway" as const,
    };
  }

  it("uses WA org-pool rows only for pool − Codex (ignores vendor slice inflation)", () => {
    const waPoolUsd = 30_138.15; // 430545 credits @ $0.07
    const vendorSliceUsd = 3_512.41; // would inflate merged.chatgpt.periodTotalUsd
    const codexUsd = 27_421.73; // 391739 credits @ $0.07
    const merged: OpenAiDailyMergedSpend = {
      chatgpt: {
        ...emptySeries(),
        periodTotalUsd: waPoolUsd + vendorSliceUsd,
        usedVendorMirror: true,
        dominantSource: "workspace_analytics",
        byYmd: new Map([
          ["2026-06-01", waPoolUsd],
          ["2026-06-02", vendorSliceUsd],
        ]),
        byYmdSource: new Map([
          ["2026-06-01", "workspace_analytics"],
          ["2026-06-02", "vendor"],
        ]),
      },
      codex: {
        ...emptySeries(),
        periodTotalUsd: codexUsd,
        usedVendorMirror: true,
        dominantSource: "codex_enterprise_analytics_sync",
        byYmd: new Map([["2026-06-01", codexUsd]]),
        byYmdSource: new Map([["2026-06-01", "codex_enterprise_analytics_sync"]]),
      },
    };

    const r = resolveOpenAiF1CreditsFromMerged({
      merged,
      periodStart: new Date(2026, 5, 1),
      periodEnd: new Date(2026, 5, 2, 23, 59, 59),
    });

    expect(r.combinedCredits).toBeCloseTo(430_545, 0);
    expect(r.codexCredits).toBeCloseTo(391_739, 0);
    expect(r.chatgptCredits).toBeCloseTo(38_806, 0);
  });

  it("adds unified-credits days to org pool as chat + cod slices", () => {
    const merged: OpenAiDailyMergedSpend = {
      chatgpt: {
        ...emptySeries(),
        periodTotalUsd: 700,
        usedVendorMirror: true,
        dominantSource: "unified_credits",
        byYmd: new Map([["2026-06-21", 700]]),
        byYmdSource: new Map([["2026-06-21", "unified_credits"]]),
      },
      codex: {
        ...emptySeries(),
        periodTotalUsd: 300,
        usedVendorMirror: true,
        dominantSource: "unified_credits",
        byYmd: new Map([["2026-06-21", 300]]),
        byYmdSource: new Map([["2026-06-21", "unified_credits"]]),
      },
    };

    const r = resolveOpenAiF1CreditsFromMerged({
      merged,
      periodStart: new Date(2026, 5, 21),
      periodEnd: new Date(2026, 5, 21, 23, 59, 59),
    });

    expect(r.combinedCredits).toBeCloseTo(14_285.7, 0);
    expect(r.chatgptCredits).toBeCloseTo(10_000, 0);
    expect(r.codexCredits).toBeCloseTo(4_285.7, 0);
  });
});
