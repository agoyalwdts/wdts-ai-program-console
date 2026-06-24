import { describe, expect, it } from "vitest";
import {
  mergeUnifiedCreditsChatGptIntoF1,
  mergeUnifiedCreditsCodexIntoF1,
} from "./f1-unified-credits-spend";
import type { ProductKey } from "@/lib/program";

describe("mergeUnifiedCreditsIntoF1", () => {
  it("overwrites CHATGPT and CODEX when unified credits series are used", () => {
    const mtdMap = new Map<ProductKey, number>([
      ["CHATGPT", 1],
      ["CODEX", 2],
    ] as [ProductKey, number][]);
    const days = [{ day: "6/18", CHATGPT: 0, CODEX: 0, CURSOR: 0, CLAUDE_AI: 0, M365_COPILOT: 0 }];

    mergeUnifiedCreditsChatGptIntoF1({
      mtdMap,
      days,
      chatgpt: { periodTotalUsd: 100, byChartDay: new Map([["6/18", 40]]), used: true },
    });
    mergeUnifiedCreditsCodexIntoF1({
      mtdMap,
      days,
      codex: { periodTotalUsd: 300, byChartDay: new Map([["6/18", 60]]), used: true },
    });

    expect(mtdMap.get("CHATGPT")).toBe(100);
    expect(mtdMap.get("CODEX")).toBe(300);
    expect(days[0]?.CHATGPT).toBe(40);
    expect(days[0]?.CODEX).toBe(60);
  });
});
