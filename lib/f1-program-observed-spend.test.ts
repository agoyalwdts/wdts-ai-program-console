import { describe, expect, it } from "vitest";
import {
  annualizedProgramActualUsdForYtd,
  budgetMonthMultiplierForWindow,
  effectiveCursorYtdWindow,
  programObservedTotalUsd,
  programPlanningYtdUsdForActuals,
  programYtdActualUsdForProduct,
  programYtdComparisonRows,
} from "./f1-program-observed-spend";
import {
  cursorProgramStartDate,
  MONTHLY_BUDGET_USD,
  OPENAI_COMBINED_MONTHLY_PLANNING_USD,
  PROGRAM_ANNUAL_PLANNING_YTD_ACTUALS_USD,
  YTD_ACTUALS_EXCLUDED_PRODUCTS,
  type ProductKey,
} from "./program";

describe("budgetMonthMultiplierForWindow", () => {
  it("returns ~1 for a full calendar month span", () => {
    const start = new Date(2026, 5, 1);
    const end = new Date(2026, 5, 30, 23, 59, 59);
    const m = budgetMonthMultiplierForWindow(start, end);
    expect(m).toBeGreaterThan(0.9);
    expect(m).toBeLessThan(1.05);
  });
});

describe("programObservedTotalUsd", () => {
  it("includes M365 at prepaid monthly commit prorated by multiplier", () => {
    const byProduct = new Map<ProductKey, number>([
      ["CURSOR", 1000],
      ["CHATGPT", 200],
      ["CODEX", 300],
      ["CLAUDE_AI", 50],
      ["M365_COPILOT", 0],
    ]);
    const total = programObservedTotalUsd({ byProduct, budgetMonthMultiplier: 1 });
    expect(total).toBeGreaterThan(1000 + 200 + 300 + 50);
  });

  it("excludes products listed in excludeProducts", () => {
    const byProduct = new Map<ProductKey, number>([
      ["CURSOR", 1000],
      ["CHATGPT", 200],
      ["CODEX", 300],
      ["CLAUDE_AI", 50],
      ["M365_COPILOT", 0],
    ]);
    const total = programObservedTotalUsd({
      byProduct,
      budgetMonthMultiplier: 1,
      excludeProducts: YTD_ACTUALS_EXCLUDED_PRODUCTS,
    });
    expect(total).toBeLessThan(1000 + 200 + 300 + 50 + MONTHLY_BUDGET_USD.M365_COPILOT);
    expect(total).toBeCloseTo(1000 + 200 + 300 + MONTHLY_BUDGET_USD.M365_COPILOT, 2);
  });
});

describe("effectiveCursorYtdWindow", () => {
  it("starts at Cursor go-live when YTD begins earlier in the year", () => {
    const window = effectiveCursorYtdWindow({
      ytdPeriodStart: new Date(2026, 0, 1),
      ytdPeriodEnd: new Date(2026, 5, 25, 23, 59, 59),
    });
    expect(window?.periodStart).toEqual(cursorProgramStartDate());
    expect(window?.periodEnd.getTime()).toBe(new Date(2026, 5, 25, 23, 59, 59).getTime());
  });

  it("returns null when YTD ends before Cursor go-live", () => {
    expect(
      effectiveCursorYtdWindow({
        ytdPeriodStart: new Date(2026, 0, 1),
        ytdPeriodEnd: new Date(2026, 3, 30),
      }),
    ).toBeNull();
  });
});

describe("programPlanningYtdUsdForActuals", () => {
  it("excludes Claude and prorates Cursor from May 1", () => {
    const now = new Date(2026, 5, 25, 12, 0, 0);
    const total = programPlanningYtdUsdForActuals(now);
    const janToNow = budgetMonthMultiplierForWindow(new Date(2026, 0, 1), now);
    const mayToNow = budgetMonthMultiplierForWindow(cursorProgramStartDate(), now);
    const expected =
      OPENAI_COMBINED_MONTHLY_PLANNING_USD * janToNow +
      MONTHLY_BUDGET_USD.M365_COPILOT * janToNow +
      MONTHLY_BUDGET_USD.CURSOR * mayToNow;
    expect(total).toBeCloseTo(expected, 2);
  });
});

describe("programYtdComparisonRows", () => {
  it("splits OpenAI plan 1:3 and uses M365 commit for actual", () => {
    const now = new Date(2026, 5, 25, 12, 0, 0);
    const m = budgetMonthMultiplierForWindow(new Date(2026, 0, 1), now);
    const rows = programYtdComparisonRows({
      observed: {
        byProduct: new Map([
          ["CHATGPT", 10_000],
          ["CODEX", 30_000],
          ["CURSOR", 50_000],
          ["M365_COPILOT", 0],
        ]),
        budgetMonthMultiplier: m,
      },
      now,
    });
    const chat = rows.find((r) => r.key === "CHATGPT")!;
    const cod = rows.find((r) => r.key === "CODEX")!;
    const m365 = rows.find((r) => r.key === "M365_COPILOT")!;
    expect(chat.actualUsd).toBe(10_000);
    expect(cod.actualUsd).toBe(30_000);
    expect(m365.actualUsd).toBeCloseTo(MONTHLY_BUDGET_USD.M365_COPILOT * m, 2);
    expect(chat.plannedUsd + cod.plannedUsd).toBeCloseTo(
      OPENAI_COMBINED_MONTHLY_PLANNING_USD * m,
      2,
    );
    expect(rows.find((r) => r.key === "CLAUDE_AI")?.included).toBe(false);
  });

  it("programYtdActualUsdForProduct matches programObservedTotalUsd per line", () => {
    const byProduct = new Map<ProductKey, number>([
      ["CURSOR", 1000],
      ["CHATGPT", 200],
      ["CODEX", 300],
      ["CLAUDE_AI", 50],
      ["M365_COPILOT", 0],
    ]);
    const m = 1;
    const total = programObservedTotalUsd({
      byProduct,
      budgetMonthMultiplier: m,
      excludeProducts: YTD_ACTUALS_EXCLUDED_PRODUCTS,
    });
    const sum = programYtdComparisonRows({ observed: { byProduct, budgetMonthMultiplier: m } })
      .filter((r) => r.included)
      .reduce((s, r) => s + r.actualUsd, 0);
    expect(sum).toBeCloseTo(total, 2);
    expect(
      programYtdActualUsdForProduct({ key: "CLAUDE_AI", byProduct, budgetMonthMultiplier: m }),
    ).toBe(0);
  });
});

describe("annualizedProgramActualUsdForYtd", () => {
  it("scales observed YTD against the matching planning envelope", () => {
    const annualized = annualizedProgramActualUsdForYtd({
      observedYtdUsd: 150_000,
      planningYtdUsd: 75_000,
    });
    expect(annualized).toBeCloseTo(PROGRAM_ANNUAL_PLANNING_YTD_ACTUALS_USD * 2, 2);
  });
});
