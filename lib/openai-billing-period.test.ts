import { describe, expect, it } from "vitest";
import {
  describeOpenAiBillingPeriodToDate,
  endOfOpenAiChatGptCodexBillingPeriod,
  f1GatewayDailySinceForMonthView,
  openAiBillingPeriodStartSec,
  openAiChatGptCodexPeriodStartForF1,
  startOfOpenAiChatGptCodexBillingPeriod,
} from "./openai-billing-period";

describe("startOfOpenAiChatGptCodexBillingPeriod", () => {
  it("uses the 16th of the current month when on or after anchor", () => {
    const now = new Date(2026, 4, 20, 12, 0, 0);
    const start = startOfOpenAiChatGptCodexBillingPeriod(now);
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(4);
    expect(start.getDate()).toBe(16);
  });

  it("uses the 16th of the previous month before anchor", () => {
    const now = new Date(2026, 4, 10, 12, 0, 0);
    const start = startOfOpenAiChatGptCodexBillingPeriod(now);
    expect(start.getMonth()).toBe(3);
    expect(start.getDate()).toBe(16);
  });
});

describe("endOfOpenAiChatGptCodexBillingPeriod", () => {
  it("is one month after period start", () => {
    const now = new Date(2026, 4, 20);
    const start = startOfOpenAiChatGptCodexBillingPeriod(now);
    const end = endOfOpenAiChatGptCodexBillingPeriod(now);
    expect(end.getTime()).toBe(
      new Date(start.getFullYear(), start.getMonth() + 1, 16, 0, 0, 0, 0).getTime(),
    );
  });
});

describe("describeOpenAiBillingPeriodToDate", () => {
  it("uses full year on both ends", () => {
    const now = new Date(2026, 4, 19);
    const s = describeOpenAiBillingPeriodToDate(now);
    expect(s).toContain("2026");
    expect(s).toMatch(/May 16.*May 19/);
  });
});

describe("openAiChatGptCodexPeriodStartForF1", () => {
  it("uses billing anchor for month period only", () => {
    const now = new Date(2026, 4, 20);
    const planStart = new Date(2026, 4, 1);
    expect(openAiChatGptCodexPeriodStartForF1(now, "month", planStart).getDate()).toBe(16);
    expect(openAiChatGptCodexPeriodStartForF1(now, "quarter", planStart)).toBe(planStart);
  });
});

describe("f1GatewayDailySinceForMonthView", () => {
  it("extends the chart back to billing start when it precedes calendar month", () => {
    const now = new Date(2026, 4, 10);
    const planStart = new Date(2026, 4, 1);
    const since = f1GatewayDailySinceForMonthView(planStart, now);
    expect(since.getDate()).toBe(16);
    expect(since.getMonth()).toBe(3);
  });

  it("uses calendar month start when billing start is later in the month", () => {
    const now = new Date(2026, 4, 20);
    const planStart = new Date(2026, 4, 1);
    const since = f1GatewayDailySinceForMonthView(planStart, now);
    expect(since.getTime()).toBe(planStart.getTime());
  });
});

describe("openAiBillingPeriodStartSec", () => {
  it("matches start date in seconds", () => {
    const now = new Date(2026, 4, 20);
    expect(openAiBillingPeriodStartSec(now)).toBe(
      Math.floor(startOfOpenAiChatGptCodexBillingPeriod(now).getTime() / 1000),
    );
  });
});
