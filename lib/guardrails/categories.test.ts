import { describe, expect, it } from "vitest";
import { guardrailCategoryLabel, GUARDRAIL_CATEGORY } from "./categories";

describe("guardrailCategoryLabel", () => {
  it("labels USAGE_POSTURE for Codex credit rules", () => {
    expect(
      guardrailCategoryLabel(
        GUARDRAIL_CATEGORY.USAGE_POSTURE,
        "CODEX_HIGH_DAILY_CREDITS",
      ),
    ).toBe("Usage / credits");
  });

  it("fixes legacy COMPLEXITY_ADVISOR on Codex analytics rule codes", () => {
    expect(
      guardrailCategoryLabel(
        GUARDRAIL_CATEGORY.COMPLEXITY_ADVISOR,
        "CODEX_HIGH_DAILY_CREDITS",
      ),
    ).toBe("Usage / credits");
  });
});
