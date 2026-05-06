import { describe, expect, it } from "vitest";
import {
  analyticsWindowToEpochMs,
  CURSOR_DAILY_USAGE_MAX_RANGE_MS,
} from "./cursor-analytics-dates";

describe("analyticsWindowToEpochMs", () => {
  it("parses YYYY-MM-DD range", () => {
    const { startMs, endMs } = analyticsWindowToEpochMs({
      startDate: "2026-01-01",
      endDate: "2026-01-07",
    });
    expect(endMs).toBeGreaterThan(startMs);
    expect(endMs - startMs).toBeLessThanOrEqual(8 * 24 * 60 * 60 * 1000);
  });

  it("clamps span to 30 days", () => {
    const { startMs, endMs } = analyticsWindowToEpochMs({
      startDate: "2025-01-01",
      endDate: "2026-06-01",
    });
    expect(endMs - startMs).toBeLessThanOrEqual(CURSOR_DAILY_USAGE_MAX_RANGE_MS + 1000);
  });

  it("handles endDate today", () => {
    const { endMs } = analyticsWindowToEpochMs({
      startDate: "2026-05-01",
      endDate: "today",
    });
    expect(endMs).toBeLessThanOrEqual(Date.now() + 60_000);
  });
});
