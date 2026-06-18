import { describe, expect, it } from "vitest";
import {
  adjacentCodexTier,
  buildCodexTierAssignmentFile,
  codexTierMoveDecisionType,
  codexSubTierToLicenseSubTier,
  licenseSubTierToCodexSubTier,
} from "@/lib/policy/codex-tier";

describe("codex-tier policy helpers", () => {
  it("maps license subTier strings", () => {
    expect(licenseSubTierToCodexSubTier("codex_power")).toBe("POWER");
    expect(codexSubTierToLicenseSubTier("LIGHT")).toBe("codex_light");
  });

  it("computes adjacent tiers", () => {
    expect(adjacentCodexTier("DISCOVERY", "promote")).toBe("LIGHT");
    expect(adjacentCodexTier("LIGHT", "demote")).toBe("DISCOVERY");
    expect(adjacentCodexTier("POWER", "promote")).toBeNull();
    expect(adjacentCodexTier("DISCOVERY", "demote")).toBeNull();
  });

  it("classifies promotion vs demotion", () => {
    expect(codexTierMoveDecisionType("DISCOVERY", "LIGHT")).toBe("TIER_PROMOTION");
    expect(codexTierMoveDecisionType("STANDARD", "LIGHT")).toBe("TIER_DEMOTION");
  });

  it("builds assignment delta file", () => {
    const file = buildCodexTierAssignmentFile({
      decisionId: "dec-1",
      email: "alice@wdts.com",
      fromSubTier: "DISCOVERY",
      toSubTier: "LIGHT",
      justification: "Hot seat — promote per ladder.",
      actorEmail: "admin@wdts.com",
    });
    expect(file.path).toBe("assignments/codex/dec-1.yaml");
    expect(file.content).toContain("subject_email: alice@wdts.com");
    expect(file.content).toContain("to_sub_tier: codex_light");
    expect(file.content).toContain("cap_usd_month: 1000");
  });
});
