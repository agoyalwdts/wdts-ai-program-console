import { describe, expect, it } from "vitest";
import { CURSOR_GLOBAL_REGION_ALERT_WHERE } from "./ack-cursor-global-region-alerts";

describe("CURSOR_GLOBAL_REGION_ALERT_WHERE", () => {
  it("targets open CURSOR global region false positives", () => {
    expect(CURSOR_GLOBAL_REGION_ALERT_WHERE).toEqual({
      ruleCode: "REGION_OUTSIDE_STRICT_ALLOWLIST",
      product: "CURSOR",
      acknowledgedAt: null,
      rationale: { contains: "region 'global'", mode: "insensitive" },
    });
  });
});
