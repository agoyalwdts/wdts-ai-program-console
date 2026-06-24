import { describe, expect, it, vi } from "vitest";
import {
  calendarDaysSinceMonthStart,
  resolveVendorMirrorLookbackDays,
} from "./vendor-mirror-lookback";

const CURSOR_OPTS = {
  min: 1,
  maxOnRefresh: 31,
  maxOnCron: 31,
  initial: 31,
} as const;

describe("calendarDaysSinceMonthStart", () => {
  it("returns the local calendar day of month", () => {
    expect(calendarDaysSinceMonthStart(new Date(2026, 5, 24, 15, 0, 0))).toBe(24);
    expect(calendarDaysSinceMonthStart(new Date(2026, 5, 1, 0, 0, 0))).toBe(1);
  });
});

describe("resolveVendorMirrorLookbackDays", () => {
  it("uses MTD floor on page_load when delta cap would be too small", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 24, 12, 0, 0));
    const hourAgo = new Date(Date.now() - 3_600_000);
    expect(
      resolveVendorMirrorLookbackDays(hourAgo, "page_load", CURSOR_OPTS),
    ).toBe(24);
    vi.useRealTimers();
  });

  it("pulls full initial window when never synced mid-month", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 10, 12, 0, 0));
    expect(resolveVendorMirrorLookbackDays(null, "page_load", CURSOR_OPTS)).toBe(31);
    vi.useRealTimers();
  });

  it("does not apply MTD floor for admin trigger", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 24, 12, 0, 0));
    expect(resolveVendorMirrorLookbackDays(null, "admin", CURSOR_OPTS)).toBe(31);
    vi.useRealTimers();
  });
});
