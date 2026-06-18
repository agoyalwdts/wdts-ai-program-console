import { describe, expect, it } from "vitest";
import { guardrailAlertEvidenceLines } from "./alert-evidence-display";

describe("guardrailAlertEvidenceLines", () => {
  it("explains complexity advisor signals with token gap", () => {
    const lines = guardrailAlertEvidenceLines({
      ruleCode: "NON_COMPLEX_HEAVY_MODEL_SELECTED",
      product: "CURSOR",
      model: "claude-4.6-sonnet-medium-thinking",
      source: "CURSOR_ADMIN_API",
      context: {
        complexityScore: 0,
        complexityClass: "NON_COMPLEX",
        complexityThreshold: 0.35,
        tokensIn: null,
        tokensOut: null,
        tokenDataMissing: true,
        costUsd: 1.25,
        heavyModel: true,
        defaultModel: "composer-2.5-fast",
        maxMode: false,
        usageKind: "chat",
      },
    });
    expect(lines.some((l) => l.label === "Complexity score")).toBe(true);
    expect(lines.some((l) => l.label === "Token signal" && l.value.includes("Unavailable"))).toBe(
      true,
    );
    expect(lines.some((l) => l.label === "Day-one default" && l.value === "composer-2.5-fast")).toBe(
      true,
    );
  });

  it("shows Codex analytics breakdown", () => {
    const lines = guardrailAlertEvidenceLines({
      ruleCode: "CODEX_HIGH_DAILY_CREDITS",
      product: "CODEX",
      model: "gpt-5-codex-max",
      source: "CODEX_ENTERPRISE_ANALYTICS",
      context: {
        credits: 22.8,
        turns: 12,
        clientIds: ["vscode", "cli"],
        models: [{ model: "gpt-5-codex-medium", credits: 18 }, { model: "gpt-5-codex-max", credits: 4.8 }],
      },
    });
    expect(lines.some((l) => l.label === "Codex credits (daily bucket)" && l.value === "22.8")).toBe(
      true,
    );
    expect(lines.some((l) => l.label === "Model mix (analytics)")).toBe(true);
  });
});
