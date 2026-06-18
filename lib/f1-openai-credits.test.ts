import { describe, expect, it } from "vitest";
import { resolveOpenAiF1Credits } from "./f1-openai-credits";


describe("resolveOpenAiF1Credits", () => {
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
    });
    expect(r.chatgptCredits).toBeCloseTo(500_000, 0);
    expect(r.codexCredits).toBe(0);
    expect(r.combinedCredits).toBeCloseTo(500_000, 0);
  });
});
