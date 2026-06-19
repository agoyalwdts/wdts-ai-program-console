import { describe, expect, it } from "vitest";
import { deltaLookbackDays } from "./delta-lookback";

describe("deltaLookbackDays", () => {
  it("returns initial when never synced", () => {
    expect(
      deltaLookbackDays(null, "page_load", {
        min: 1,
        maxOnRefresh: 3,
        maxOnCron: 7,
        initial: 7,
      }),
    ).toBe(3);
  });

  it("caps page_load lookback at maxOnRefresh", () => {
    const weekAgo = new Date(Date.now() - 8 * 86_400_000);
    expect(
      deltaLookbackDays(weekAgo, "page_load", {
        min: 1,
        maxOnRefresh: 3,
        maxOnCron: 7,
        initial: 7,
      }),
    ).toBe(3);
  });

  it("uses higher cap for cron", () => {
    const weekAgo = new Date(Date.now() - 8 * 86_400_000);
    expect(
      deltaLookbackDays(weekAgo, "cron", {
        min: 1,
        maxOnRefresh: 3,
        maxOnCron: 7,
        initial: 7,
      }),
    ).toBe(7);
  });

  it("returns min when last success was within the last day", () => {
    const hourAgo = new Date(Date.now() - 3_600_000);
    expect(
      deltaLookbackDays(hourAgo, "page_load", {
        min: 1,
        maxOnRefresh: 3,
        maxOnCron: 7,
        initial: 7,
      }),
    ).toBe(2);
  });
});
