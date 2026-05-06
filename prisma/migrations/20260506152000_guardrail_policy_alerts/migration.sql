-- AlterEnum
ALTER TYPE "DecisionType" ADD VALUE 'GUARDRAIL_POLICY_ALERT';

-- CreateTable
CREATE TABLE "GuardrailPolicyAlert" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "category" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "ruleCode" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "recommendation" TEXT,
  "environment" TEXT,
  "product" "Product",
  "userEmail" TEXT,
  "model" TEXT,
  "source" TEXT,
  "context" JSONB NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "acknowledgedAt" TIMESTAMP(3),
  "emailNotifiedAt" TIMESTAMP(3),

  CONSTRAINT "GuardrailPolicyAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuardrailPolicyAlert_dedupeKey_key" ON "GuardrailPolicyAlert"("dedupeKey");
CREATE INDEX "GuardrailPolicyAlert_occurredAt_idx" ON "GuardrailPolicyAlert"("occurredAt");
CREATE INDEX "GuardrailPolicyAlert_category_severity_idx" ON "GuardrailPolicyAlert"("category", "severity");
CREATE INDEX "GuardrailPolicyAlert_acknowledgedAt_idx" ON "GuardrailPolicyAlert"("acknowledgedAt");
CREATE INDEX "GuardrailPolicyAlert_product_occurredAt_idx" ON "GuardrailPolicyAlert"("product", "occurredAt");
