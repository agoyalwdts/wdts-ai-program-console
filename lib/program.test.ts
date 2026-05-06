import { describe, expect, it } from "vitest";
import {
  OPENAI_CREDIT_OVERAGE_USD,
  OPENAI_POOLED_BASELINE_USD_MONTH,
  OPENAI_POOLED_CREDITS_MONTH,
  openAiCombinedCreditsUsedEstimate,
} from "./program";

describe("openAiCombinedCreditsUsedEstimate", () => {
  it("returns 0 credits when spend is 0", () => {
    expect(
      openAiCombinedCreditsUsedEstimate({ periodSpendUsd: 0, budgetMonthMultiplier: 1 }),
    ).toBe(0);
  });

  it("scales linearly within the pool when spend is below baseline USD", () => {
    const m = 1;
    const halfBaseline = OPENAI_POOLED_BASELINE_USD_MONTH / 2;
    expect(
      openAiCombinedCreditsUsedEstimate({
        periodSpendUsd: halfBaseline,
        budgetMonthMultiplier: m,
      }),
    ).toBeCloseTo(OPENAI_POOLED_CREDITS_MONTH / 2, 5);
  });

  it("maps full baseline USD to full pooled credits", () => {
    expect(
      openAiCombinedCreditsUsedEstimate({
        periodSpendUsd: OPENAI_POOLED_BASELINE_USD_MONTH,
        budgetMonthMultiplier: 1,
      }),
    ).toBeCloseTo(OPENAI_POOLED_CREDITS_MONTH, 5);
  });

  it("adds overage credits at marginal rate above baseline", () => {
    const extraUsd = 700;
    const extraCredits = extraUsd / OPENAI_CREDIT_OVERAGE_USD;
    expect(
      openAiCombinedCreditsUsedEstimate({
        periodSpendUsd: OPENAI_POOLED_BASELINE_USD_MONTH + extraUsd,
        budgetMonthMultiplier: 1,
      }),
    ).toBeCloseTo(OPENAI_POOLED_CREDITS_MONTH + extraCredits, 5);
  });

  it("multiplies pool and baseline by month multiplier", () => {
    const m = 2;
    expect(
      openAiCombinedCreditsUsedEstimate({
        periodSpendUsd: OPENAI_POOLED_BASELINE_USD_MONTH * m,
        budgetMonthMultiplier: m,
      }),
    ).toBeCloseTo(OPENAI_POOLED_CREDITS_MONTH * m, 5);
  });
});
