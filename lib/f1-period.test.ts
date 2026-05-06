import { describe, expect, it } from "vitest";
import {
  f1PeriodSpendLabel,
  parseF1Period,
  parseLocalYmd,
  planF1CustomPeriod,
  planF1Period,
  resolveF1PlanFromSearchParams,
} from "./f1-period";

describe("parseF1Period", () => {
  it("defaults to month", () => {
    expect(parseF1Period(undefined)).toBe("month");
    expect(parseF1Period("")).toBe("month");
    expect(parseF1Period("nope")).toBe("month");
  });

  it("accepts quarter, year, and custom", () => {
    expect(parseF1Period("quarter")).toBe("quarter");
    expect(parseF1Period("year")).toBe("year");
    expect(parseF1Period("custom")).toBe("custom");
  });
});

describe("parseLocalYmd", () => {
  it("parses valid YYYY-MM-DD in local TZ", () => {
    const d = parseLocalYmd("2026-05-01");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(4);
    expect(d!.getDate()).toBe(1);
  });

  it("rejects invalid dates", () => {
    expect(parseLocalYmd(undefined)).toBeNull();
    expect(parseLocalYmd("2026-13-01")).toBeNull();
    expect(parseLocalYmd("2026-02-30")).toBeNull();
  });
});

describe("planF1CustomPeriod", () => {
  it("caps end to now and computes inclusive span", () => {
    const now = new Date(2026, 4, 10, 15, 0, 0);
    const p = planF1CustomPeriod(now, "2026-05-01", "2026-05-31");
    expect(p.periodStart.getTime()).toBe(new Date(2026, 4, 1, 0, 0, 0, 0).getTime());
    expect(p.periodEnd.getTime()).toBe(now.getTime());
    expect(p.budgetMonthMultiplier).toBeGreaterThan(0);
    expect(p.budgetMonthMultiplier).toBeLessThanOrEqual(1.1);
  });

  it("swaps when from after to", () => {
    const now = new Date(2026, 4, 10, 12, 0, 0);
    const p = planF1CustomPeriod(now, "2026-05-08", "2026-05-01");
    expect(p.periodStart.getDate()).toBe(1);
    expect(p.periodEnd.getTime()).toBeLessThanOrEqual(now.getTime());
  });
});

describe("resolveF1PlanFromSearchParams", () => {
  it("returns custom plan when period=custom", () => {
    const now = new Date(2026, 4, 5, 12, 0, 0);
    const { period, plan } = resolveF1PlanFromSearchParams(now, {
      period: "custom",
      from: "2026-05-01",
      to: "2026-05-05",
    });
    expect(period).toBe("custom");
    expect(plan.chartTitle).toContain("custom");
  });
});

describe("f1PeriodSpendLabel", () => {
  it("labels custom", () => {
    expect(f1PeriodSpendLabel("custom")).toBe("Custom range");
  });
});

describe("planF1Period", () => {
  it("month starts on first of month", () => {
    const now = new Date(2026, 4, 15, 12, 0, 0);
    const p = planF1Period(now, "month");
    expect(p.periodStart.getTime()).toBe(new Date(2026, 4, 1).getTime());
    expect(p.budgetMonthMultiplier).toBe(1);
  });

  it("quarter uses calendar Q2 for May", () => {
    const now = new Date(2026, 4, 15, 12, 0, 0);
    const p = planF1Period(now, "quarter");
    expect(p.periodStart.getMonth()).toBe(3); // April
    expect(p.periodStart.getDate()).toBe(1);
    expect(p.budgetMonthMultiplier).toBe(3);
  });

  it("year starts Jan 1", () => {
    const now = new Date(2026, 4, 15, 12, 0, 0);
    const p = planF1Period(now, "year");
    expect(p.periodStart.getMonth()).toBe(0);
    expect(p.budgetMonthMultiplier).toBe(12);
  });
});
