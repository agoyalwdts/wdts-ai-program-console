import { describe, expect, it } from "vitest";
import { inclusiveDayCountYmd } from "@/lib/imports/program-vendor-export/dates";

/** Mirrors clipOverlapFactor in analytics-manual-vendor-charts / f1-top-spenders-vendor. */
function overlapFactor(
  clip: { start: string; end: string },
  exportStart: string | null,
  exportEnd: string | null,
): number {
  if (!exportStart || !exportEnd) return 1;
  const os = clip.start > exportStart ? clip.start : exportStart;
  const oe = clip.end < exportEnd ? clip.end : exportEnd;
  if (os > oe) return 0;
  const overlap = inclusiveDayCountYmd(os, oe);
  const expDays = inclusiveDayCountYmd(exportStart, exportEnd);
  if (expDays <= 0) return 0;
  return overlap / expDays;
}

describe("vendor top-spender proration overlap", () => {
  it("returns 0 when export and clip do not overlap", () => {
    expect(
      overlapFactor({ start: "2026-01-01", end: "2026-01-10" }, "2026-02-01", "2026-02-28"),
    ).toBe(0);
  });

  it("prorates May partial window inside a longer export", () => {
    const clip = { start: "2026-05-01", end: "2026-05-06" };
    const f = overlapFactor(clip, "2026-02-06", "2026-05-06");
    const overlap = inclusiveDayCountYmd("2026-05-01", "2026-05-06");
    expect(overlap).toBe(6);
    expect(f).toBeCloseTo(6 / inclusiveDayCountYmd("2026-02-06", "2026-05-06"), 8);
  });
});
