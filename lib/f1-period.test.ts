import { describe, expect, it } from "vitest";
import { parseF1Period, planF1Period } from "./f1-period";

describe("parseF1Period", () => {
  it("defaults to month", () => {
    expect(parseF1Period(undefined)).toBe("month");
    expect(parseF1Period("")).toBe("month");
    expect(parseF1Period("nope")).toBe("month");
  });

  it("accepts quarter and year", () => {
    expect(parseF1Period("quarter")).toBe("quarter");
    expect(parseF1Period("year")).toBe("year");
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
