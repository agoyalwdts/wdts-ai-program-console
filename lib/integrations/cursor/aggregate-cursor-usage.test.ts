import { describe, expect, it } from "vitest";
import {
  aggregateCursorUsageEvents,
  calendarYmdFromMillis,
  cursorChargedFieldToUsd,
  normCursorUserEmail,
} from "./team-admin-usage";

describe("normCursorUserEmail", () => {
  it("lowercases and trims", () => {
    expect(normCursorUserEmail("  Alice@WDTS.com ")).toBe("alice@wdts.com");
  });

  it("rejects missing @", () => {
    expect(normCursorUserEmail("alice")).toBeNull();
  });
});

describe("aggregateCursorUsageEvents", () => {
  it("rolls up by day and by day+user", () => {
    const t0 = new Date(2026, 4, 4, 10, 0, 0).getTime();
    const t1 = new Date(2026, 4, 4, 11, 0, 0).getTime();
    const { byDay, byDayUser } = aggregateCursorUsageEvents([
      { timestamp: String(t0), chargedCents: 100, userEmail: "alice@wdts.com" },
      { timestamp: String(t1), chargedCents: 50, userEmail: "alice@wdts.com" },
      { timestamp: String(t1), chargedCents: 200, userEmail: "Bob@wdts.com" },
      { timestamp: String(t1), chargedCents: 10 },
    ]);
    const ymd = calendarYmdFromMillis(t0);
    expect(byDay.get(ymd)?.spendUsd).toBeCloseTo(cursorChargedFieldToUsd(360));
    expect(byDay.get(ymd)?.eventCount).toBe(4);
    expect(byDayUser.get(ymd)?.get("alice@wdts.com")?.spendUsd).toBeCloseTo(1.5);
    expect(byDayUser.get(ymd)?.get("bob@wdts.com")?.spendUsd).toBeCloseTo(2);
  });
});
