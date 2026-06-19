import { describe, expect, it } from "vitest";
import {
  ALLOWED_COST_CENTRES,
  isCostCentre,
  seedCostCentreForEmail,
} from "./cost-centres";

describe("cost-centres", () => {
  it("validates allowlisted keys", () => {
    expect(isCostCentre("ENG-4501")).toBe(true);
    expect(isCostCentre("eng-4501")).toBe(false);
    expect(isCostCentre(null)).toBe(false);
    expect(isCostCentre("NOT-IN-LIST")).toBe(false);
  });

  it("assigns deterministic seed codes", () => {
    const a = seedCostCentreForEmail("alice@wdts.com");
    const b = seedCostCentreForEmail("alice@wdts.com");
    expect(ALLOWED_COST_CENTRES).toContain(a);
    expect(a).toBe(b);
  });
});
