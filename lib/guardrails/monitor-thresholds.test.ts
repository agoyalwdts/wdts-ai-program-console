import { describe, expect, it } from "vitest";
import {
  passesGuardrailCostFloor,
  resolveGuardrailMinCostUsd,
  shouldSkipRegionAllowlistCheck,
} from "./monitor-thresholds";

describe("resolveGuardrailMinCostUsd", () => {
  it("defaults to $1", () => {
    expect(resolveGuardrailMinCostUsd({})).toBe(1);
  });

  it("reads GUARDRAIL_MIN_COST_USD", () => {
    expect(resolveGuardrailMinCostUsd({ GUARDRAIL_MIN_COST_USD: "2.5" })).toBe(2.5);
  });
});

describe("shouldSkipRegionAllowlistCheck", () => {
  it("skips Cursor admin API and global region", () => {
    expect(shouldSkipRegionAllowlistCheck("CURSOR_ADMIN_API", "global")).toBe(true);
    expect(shouldSkipRegionAllowlistCheck("USAGE_RECORD", "global")).toBe(true);
  });

  it("checks gateway regions", () => {
    expect(shouldSkipRegionAllowlistCheck("USAGE_RECORD", "centralindia")).toBe(false);
  });
});

describe("passesGuardrailCostFloor", () => {
  it("gates complexity advisor rules on cost", () => {
    expect(
      passesGuardrailCostFloor({
        ruleCode: "NON_COMPLEX_NON_DEFAULT_MODEL",
        costUsd: 0.5,
        minCostUsd: 1,
      }),
    ).toBe(false);
    expect(
      passesGuardrailCostFloor({
        ruleCode: "NON_COMPLEX_NON_DEFAULT_MODEL",
        costUsd: 1.25,
        minCostUsd: 1,
      }),
    ).toBe(true);
    expect(
      passesGuardrailCostFloor({
        ruleCode: "DAY_ONE_DISABLED_MODE_USED",
        costUsd: 0,
        minCostUsd: 1,
      }),
    ).toBe(true);
  });
});
