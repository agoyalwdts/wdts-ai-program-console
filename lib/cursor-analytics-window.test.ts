import { describe, expect, it, vi } from "vitest";
import { analyticsWindowForF1Plan } from "./cursor-analytics-window";
import type { F1PeriodPlan } from "./f1-period";

describe("analyticsWindowForF1Plan", () => {
  it("uses today as endDate when the window ends on the same local calendar day as now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 6, 14, 0, 0));

    const plan: F1PeriodPlan = {
      periodStart: new Date(2026, 4, 1),
      periodEnd: new Date(2026, 4, 6, 20, 0, 0),
      budgetMonthMultiplier: 1,
      chartTitle: "",
      rangeDescription: "",
    };
    const w = analyticsWindowForF1Plan(plan);
    expect(w.startDate).toBe("2026-05-01");
    expect(w.endDate).toBe("today");

    vi.useRealTimers();
  });

  it("uses YYYY-MM-DD end when the window ends on an earlier local day than now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 20, 12, 0, 0));

    const plan: F1PeriodPlan = {
      periodStart: new Date(2026, 4, 1),
      periodEnd: new Date(2026, 4, 6, 23, 0, 0),
      budgetMonthMultiplier: 1,
      chartTitle: "",
      rangeDescription: "",
    };
    const w = analyticsWindowForF1Plan(plan);
    expect(w.endDate).toBe("2026-05-06");

    vi.useRealTimers();
  });
});
