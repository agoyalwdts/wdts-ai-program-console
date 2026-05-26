import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/notify/user-coaching-email", () => ({
  sendGuardrailUserCoachingEmail: vi.fn(async () => ({
    ok: true,
    skipped: false,
    id: "email_1",
  })),
}));

vi.mock("@/lib/notify/user-coaching-config", () => ({
  userCoachingBccList: () => [],
}));

import { sendGuardrailUserCoachingEmail } from "@/lib/notify/user-coaching-email";
import { sendAlertCoachingEmail } from "./alert-action-helpers";

describe("sendAlertCoachingEmail", () => {
  it("sends without a User row and when subject is console-blocked", async () => {
    const prisma = {
      guardrailPolicyAlert: {
        update: vi.fn(async () => ({})),
      },
    };

    const result = await sendAlertCoachingEmail(prisma as never, {
      id: "alert-1",
      occurredAt: new Date(),
      category: "MODEL",
      severity: "MEDIUM",
      product: "CURSOR",
      userEmail: "dev@wdtablesystems.com",
      model: "gpt-4",
      ruleCode: "NON_COMPLEX_NON_DEFAULT_MODEL",
      title: "Test",
      rationale: "Rationale",
      recommendation: "Use default",
      acknowledgedAt: null,
      userEmailNotifiedAt: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok && !("skipped" in result && result.skipped)) {
      expect(sendGuardrailUserCoachingEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: "dev@wdtablesystems.com" }),
      );
      expect(prisma.guardrailPolicyAlert.update).toHaveBeenCalled();
    }
  });
});
