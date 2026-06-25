import { describe, expect, it } from "vitest";
import { resolveOpenAiF1Credits } from "./f1-openai-credits";


describe("resolveOpenAiF1Credits", () => {
  const noUnified = {
    unifiedChatgptUsed: false,
    unifiedChatgptUsd: 0,
    unifiedCodexUsed: false,
    unifiedCodexUsd: 0,
  };

  it("uses composite merged USD for credits when vendorMirrorCompositeUsed", () => {
    const r = resolveOpenAiF1Credits({
      chatgptUsd: 500,
      codexUsd: 800,
      budgetMonthMultiplier: 1,
      workspaceChatgptUsed: false,
      workspaceChatgptUsd: 0,
      manualChatgptUsed: false,
      manualChatgptUsd: 0,
      codexEnterpriseUsed: false,
      codexEnterpriseUsd: 0,
      unifiedChatgptUsed: true,
      unifiedChatgptUsd: 30,
      unifiedCodexUsed: true,
      unifiedCodexUsd: 70,
      vendorMirrorCompositeUsed: true,
    });
    expect(r.mode).toBe("direct");
    expect(r.chatgptCredits).toBeCloseTo(500 / 0.07, 0);
    expect(r.codexCredits).toBeGreaterThan(0);
    expect(r.combinedCredits).toBeCloseTo(r.chatgptCredits + r.codexCredits, 0);
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
