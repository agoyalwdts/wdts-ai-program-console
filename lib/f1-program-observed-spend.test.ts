import { describe, expect, it } from "vitest";
import {
  budgetMonthMultiplierForWindow,
  programObservedTotalUsd,
} from "./f1-program-observed-spend";
import type { ProductKey } from "@/lib/program";

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
});
