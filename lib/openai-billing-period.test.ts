import { describe, expect, it } from "vitest";
import {
  describeOpenAiBillingPeriodToDate,
  endOfOpenAiChatGptCodexBillingPeriod,
  openAiBillingPeriodStartSec,
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

describe("openAiBillingPeriodStartSec", () => {
  it("matches start date in seconds", () => {
    const now = new Date(2026, 4, 20);
    expect(openAiBillingPeriodStartSec(now)).toBe(
      Math.floor(startOfOpenAiChatGptCodexBillingPeriod(now).getTime() / 1000),
    );
  });
});
