-- Per-user model coaching emails (Resend) — separate from operator digests.

ALTER TABLE "GuardrailPolicyAlert" ADD COLUMN "userEmailNotifiedAt" TIMESTAMP(3);

ALTER TABLE "CursorUsagePrudenceAlert" ADD COLUMN "userEmailNotifiedAt" TIMESTAMP(3);
