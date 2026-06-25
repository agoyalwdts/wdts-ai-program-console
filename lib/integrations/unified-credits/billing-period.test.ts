import { describe, expect, it } from "vitest";
import { costsDayInCurrentBillingPeriod, openAiBillingPeriodBounds } from "./billing-period";

describe("unified-credits billing-period", () => {
  it("anchors billing period on the 16th", () => {
    const now = new Date(2026, 4, 28, 12, 0, 0, 0); // May 28 local
    const bounds = openAiBillingPeriodBounds(now);
    expect(bounds.startYmd).toBe("2026-05-16");
    expect(bounds.endYmdInclusive).toBe("2026-05-28");
    expect(costsDayInCurrentBillingPeriod("2026-05-15", now)).toBe(false);
    expect(costsDayInCurrentBillingPeriod("2026-05-16", now)).toBe(true);
  });
});
