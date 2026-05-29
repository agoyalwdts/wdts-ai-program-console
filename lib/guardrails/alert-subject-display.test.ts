import { describe, expect, it } from "vitest";
import {
  codexUserIdFromDedupeKey,
  guardrailAlertSubjectLabel,
} from "./alert-subject-display";

describe("guardrailAlertSubjectLabel", () => {
  it("prefers email when present", () => {
    expect(
      guardrailAlertSubjectLabel({
        userEmail: "dev@wdts.com",
        ruleCode: "CODEX_HIGH_DAILY_CREDITS",
      }),
    ).toBe("dev@wdts.com");
  });

  it("shows codex user id from context", () => {
    expect(
      guardrailAlertSubjectLabel({
        userEmail: null,
        ruleCode: "CODEX_HIGH_DAILY_CREDITS",
        context: { codexUserId: "user-abc-123" },
      }),
    ).toBe("codex user user-abc-123");
  });

  it("falls back to dedupe key subject segment", () => {
    expect(
      guardrailAlertSubjectLabel({
        userEmail: null,
        ruleCode: "CODEX_HIGH_DAILY_CREDITS",
        dedupeKey: "CODEX_HIGH_DAILY_CREDITS|user-legacy|2026-05-28",
      }),
    ).toBe("codex user user-legacy");
  });
});

describe("codexUserIdFromDedupeKey", () => {
  it("returns null for email-shaped dedupe keys", () => {
    expect(
      codexUserIdFromDedupeKey(
        "CODEX_HIGH_DAILY_CREDITS",
        "CODEX_HIGH_DAILY_CREDITS|dev@wdts.com|2026-05-28",
      ),
    ).toBeNull();
  });
});
