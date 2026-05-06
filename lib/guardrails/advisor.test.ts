import { describe, expect, it } from "vitest";
import { evaluateModelAdvisor, estimateComplexityScore } from "./advisor";

describe("guardrails advisor", () => {
  it("flags non-complex heavy model and recommends default", () => {
    const out = evaluateModelAdvisor({
      product: "CODEX",
      selectedModel: "gpt-5.5-pro",
      tokensIn: 350,
      tokensOut: 120,
      maxMode: false,
    });
    expect(out.complexityClass).toBe("NON_COMPLEX");
    expect(out.heavyModel).toBe(true);
    expect(out.recommendation).toBe("gpt-5-codex-medium");
    expect(out.message).toMatch(/non-complex/i);
  });

  it("flags disallowed day-one mode markers", () => {
    const out = evaluateModelAdvisor({
      product: "CURSOR",
      selectedModel: "cursor-fast-yolo-v2",
      tokensIn: 6000,
      tokensOut: 3000,
      maxMode: true,
    });
    expect(out.disabledModeHit).toBe(true);
    expect(out.recommendation).toBe("claude-4.6-sonnet");
  });

  it("estimates complexity from tokens when explicit score missing", () => {
    const low = estimateComplexityScore({
      product: "CHATGPT",
      selectedModel: "gpt-5.3",
      tokensIn: 200,
      tokensOut: 120,
      maxMode: false,
    });
    const high = estimateComplexityScore({
      product: "CHATGPT",
      selectedModel: "gpt-5.3",
      tokensIn: 9500,
      tokensOut: 3800,
      maxMode: true,
    });
    expect(low).toBeLessThan(0.35);
    expect(high).toBeGreaterThan(0.8);
  });
});
