import { describe, expect, it } from "vitest";
import {
  adjacentCursorTier,
  buildCursorReclamationFile,
  buildCursorTierAssignmentFile,
  cursorTierMoveDecisionType,
} from "@/lib/policy/cursor-tier";

describe("cursor-tier policy helpers", () => {
  it("computes adjacent tiers", () => {
    expect(adjacentCursorTier("DISCOVERY", "promote")).toBe("LIGHT");
    expect(adjacentCursorTier("POWER", "promote")).toBeNull();
  });

  it("classifies promotion vs demotion", () => {
    expect(cursorTierMoveDecisionType("DISCOVERY", "LIGHT")).toBe("TIER_PROMOTION");
  });

  it("builds tier and reclamation assignment files", () => {
    const tier = buildCursorTierAssignmentFile({
      decisionId: "d1",
      email: "a@wdts.com",
      fromSubTier: "DISCOVERY",
      toSubTier: "LIGHT",
      justification: "Promote.",
      actorEmail: "admin@wdts.com",
    });
    expect(tier.path).toBe("assignments/cursor/d1.yaml");

    const reclaim = buildCursorReclamationFile({
      decisionId: "d2",
      reclamationEventId: "r1",
      email: "a@wdts.com",
      licenseSubTier: "cursor_standard",
      justification: "Idle reclaim.",
      actorEmail: "admin@wdts.com",
    });
    expect(reclaim.path).toContain("reclaims");
  });
});
