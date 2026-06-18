import { describe, expect, it } from "vitest";
import { computeLeaderboardPctOfCap } from "./f1-health-leaderboards";

describe("computeLeaderboardPctOfCap", () => {
  it("scales monthly cap by budgetMonthMultiplier", () => {
    const r = computeLeaderboardPctOfCap({
      periodSpendUsd: 400,
      capUsdMonth: 800,
      budgetMonthMultiplier: 0.5,
    });
    expect(r.periodCapUsd).toBe(400);
    expect(r.pctOfCap).toBe(100);
  });

  it("returns null when cap is absent", () => {
    const r = computeLeaderboardPctOfCap({
      periodSpendUsd: 100,
      capUsdMonth: null,
      budgetMonthMultiplier: 1,
    });
    expect(r.periodCapUsd).toBeNull();
    expect(r.pctOfCap).toBeNull();
  });
});
