import { describe, expect, it } from "vitest";
import {
  parseOpenAiF1Window,
  planOpenAiF1Spend,
} from "./f1-openai-window";
import { planF1Period } from "./f1-period";

describe("parseOpenAiF1Window", () => {
  it("defaults to follow", () => {
    expect(parseOpenAiF1Window(undefined)).toBe("follow");
    expect(parseOpenAiF1Window("nope")).toBe("follow");
  });

  it("accepts billing", () => {
    expect(parseOpenAiF1Window("billing")).toBe("billing");
  });
});

describe("planOpenAiF1Spend", () => {
  it("follow uses the page plan window", () => {
    const now = new Date(2026, 5, 18, 12, 0, 0);
    const pagePlan = planF1Period(now, "month");
    const openAi = planOpenAiF1Spend({ now, period: "month", pagePlan, window: "follow" });
    expect(openAi.periodStart.getDate()).toBe(1);
    expect(openAi.periodStart.getMonth()).toBe(5);
    expect(openAi.spendLabel).toBe("Month to date");
    expect(openAi.budgetMonthMultiplier).toBe(1);
  });

  it("billing uses anchor on the 16th with full-month credit envelope", () => {
    const now = new Date(2026, 5, 18, 12, 0, 0);
    const pagePlan = planF1Period(now, "month");
    const openAi = planOpenAiF1Spend({ now, period: "month", pagePlan, window: "billing" });
    expect(openAi.periodStart.getDate()).toBe(16);
    expect(openAi.periodStart.getMonth()).toBe(5);
    expect(openAi.spendLabel).toContain("Billing cycle");
    expect(openAi.budgetMonthMultiplier).toBe(1);
    expect(openAi.rangeDescription).toContain("Jun 16");
  });
});
