import { describe, expect, it } from "vitest";
import {
  calendarDayAtNoonFromYmd,
  eachYmdInclusive,
  inclusiveDayCountYmd,
} from "./dates";

describe("dates", () => {
  it("inclusiveDayCountYmd counts inclusive calendar days", () => {
    expect(inclusiveDayCountYmd("2026-04-05", "2026-04-05")).toBe(1);
    expect(inclusiveDayCountYmd("2026-04-05", "2026-04-07")).toBe(3);
  });

  it("eachYmdInclusive yields ordered YMD strings", () => {
    expect([...eachYmdInclusive("2026-05-01", "2026-05-03")]).toEqual([
      "2026-05-01",
      "2026-05-02",
      "2026-05-03",
    ]);
  });

  it("calendarDayAtNoonFromYmd is local noon", () => {
    const d = calendarDayAtNoonFromYmd("2026-04-06");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3);
    expect(d.getDate()).toBe(6);
    expect(d.getHours()).toBe(12);
  });
});
