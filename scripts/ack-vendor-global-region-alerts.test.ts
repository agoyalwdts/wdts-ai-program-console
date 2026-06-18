import { describe, expect, it } from "vitest";
import { vendorGlobalRegionAlertWhere } from "./ack-vendor-global-region-alerts";

describe("vendorGlobalRegionAlertWhere", () => {
  it("matches CURSOR and CODEX global region false positives", () => {
    expect(vendorGlobalRegionAlertWhere()).toEqual({
      ruleCode: "REGION_OUTSIDE_STRICT_ALLOWLIST",
      product: { in: ["CURSOR", "CODEX"] },
      acknowledgedAt: null,
      rationale: { contains: "region 'global'", mode: "insensitive" },
    });
  });

  it("supports single product filter", () => {
    expect(vendorGlobalRegionAlertWhere(["CODEX"])).toEqual({
      ruleCode: "REGION_OUTSIDE_STRICT_ALLOWLIST",
      product: "CODEX",
      acknowledgedAt: null,
      rationale: { contains: "region 'global'", mode: "insensitive" },
    });
  });
});
