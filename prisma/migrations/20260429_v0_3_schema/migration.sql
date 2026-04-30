-- v0.3 schema — accepts ADR 0001 (docs/decisions/0001-v0.3-schema.md).
--
-- Adds four authoritative / snapshot models: ExceptionRequest,
-- ReclamationEvent, BudgetSnapshot, FrictionBudgetMetric. Lifts five
-- string columns to Postgres enums (User.status, License.product,
-- License.source, UsageRecord.product, UsageRecord.decision,
-- Decision.type). Adds three field-level fixes: User.roleTag becomes
-- nullable, User.updatedAt with @updatedAt, UsageRecord.dlpLayersHit
-- as String[].
--
-- Migration discipline notes:
--   - Every "lift String to enum" uses ALTER COLUMN ... TYPE ... USING
--     so existing rows keep their values. The prisma-generated diff
--     wanted DROP COLUMN + ADD COLUMN which would have wiped data.
--   - User.updatedAt is added nullable, backfilled with createdAt, then
--     marked NOT NULL — the prisma-generated diff added it NOT NULL with
--     no default, which would fail on any non-empty DB.
--   - Tables Decision / License / UsageRecord / User KEEP their existing
--     indexes through the type change (ALTER COLUMN ... TYPE rebuilds
--     them transparently), so no CREATE INDEX restatement is needed for
--     those columns.

-- ---------------------------------------------------------------------------
-- 1. New enum types
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'LEFT', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "Product" AS ENUM ('CHATGPT', 'CODEX', 'CURSOR', 'CLAUDE_AI', 'M365_COPILOT');

-- CreateEnum
CREATE TYPE "LicenseSource" AS ENUM ('AUTO_PROVISIONED', 'MANUAL', 'DEEL', 'RECONCILE', 'CSV_IMPORT');

-- CreateEnum
CREATE TYPE "UsageDecision" AS ENUM ('ALLOWED', 'PROMPTED', 'BLOCKED', 'DOWNGRADED');

-- CreateEnum
CREATE TYPE "DecisionType" AS ENUM ('TIER_PROMOTION', 'TIER_DEMOTION', 'RECLAMATION', 'EXCEPTION_GRANT', 'METHODOLOGY_CHANGE', 'CAP_ADJUSTMENT', 'CURSOR_SEAT_GRANT', 'CURSOR_SEAT_RECLAIM', 'USER_INVITED', 'USER_DISABLED', 'USER_ENABLED', 'ROLE_CHANGE', 'ROLE_CREATED', 'ROLE_EDITED', 'ROLE_DELETED', 'EMPLOYEE_IMPORT');

-- CreateEnum
CREATE TYPE "ExceptionType" AS ENUM ('BUDGET_ELEVATION', 'TIER_OVERRIDE', 'JURISDICTIONAL', 'PRODUCT_ACCESS', 'OTHER');

-- CreateEnum
CREATE TYPE "ExceptionStatus" AS ENUM ('SUBMITTED', 'ATTESTED', 'UNDER_REVIEW', 'APPROVED', 'DENIED', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ReclamationTrigger" AS ENUM ('IDLE', 'CAP_BREACH', 'TIER_DEMOTION', 'HRIS_LEAVE', 'MANUAL');

-- CreateEnum
CREATE TYPE "ReclamationAction" AS ENUM ('NOTIFY', 'RECLAIM', 'DEFER', 'RELEASE');

-- CreateEnum
CREATE TYPE "ReclamationState" AS ENUM ('NOTIFIED', 'IN_DISPUTE', 'RESOLVED_RECLAIMED', 'RESOLVED_RETAINED', 'EXPIRED');

-- ---------------------------------------------------------------------------
-- 2. In-place enum lifts on existing columns. ALTER COLUMN ... TYPE ...
--    USING (col::text::Enum) reads the old TEXT value and casts it to the
--    new enum — succeeds iff every existing row already holds a valid
--    enum member, which we verified before generating this migration.
-- ---------------------------------------------------------------------------

-- AlterTable: User.status (TEXT → UserStatus, default ACTIVE)
ALTER TABLE "User"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "UserStatus" USING ("status"::"UserStatus"),
  ALTER COLUMN "status" SET DEFAULT 'ACTIVE'::"UserStatus";

-- AlterTable: User.roleTag (NOT NULL → nullable)
ALTER TABLE "User" ALTER COLUMN "roleTag" DROP NOT NULL;

-- AlterTable: User.updatedAt (new column; nullable → backfill → NOT NULL).
-- Backfill with createdAt so existing rows have a sensible "last touched"
-- value rather than the migration-application timestamp.
ALTER TABLE "User" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "User" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
ALTER TABLE "User"
  ALTER COLUMN "updatedAt" SET NOT NULL,
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable: License.product (TEXT → Product), License.source (TEXT → LicenseSource).
ALTER TABLE "License"
  ALTER COLUMN "product" TYPE "Product" USING ("product"::"Product"),
  ALTER COLUMN "source" DROP DEFAULT,
  ALTER COLUMN "source" TYPE "LicenseSource" USING ("source"::"LicenseSource"),
  ALTER COLUMN "source" SET DEFAULT 'AUTO_PROVISIONED'::"LicenseSource";

-- AlterTable: UsageRecord.product (TEXT → Product), UsageRecord.decision
-- (TEXT → UsageDecision), UsageRecord.dlpLayersHit (new String[] column).
ALTER TABLE "UsageRecord"
  ALTER COLUMN "product" TYPE "Product" USING ("product"::"Product"),
  ALTER COLUMN "decision" DROP DEFAULT,
  ALTER COLUMN "decision" TYPE "UsageDecision" USING ("decision"::"UsageDecision"),
  ALTER COLUMN "decision" SET DEFAULT 'ALLOWED'::"UsageDecision",
  ADD COLUMN "dlpLayersHit" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- AlterTable: Decision.type (TEXT → DecisionType).
ALTER TABLE "Decision"
  ALTER COLUMN "type" TYPE "DecisionType" USING ("type"::"DecisionType");

-- ---------------------------------------------------------------------------
-- 3. New tables (authoritative + snapshots)
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "ExceptionRequest" (
    "id" TEXT NOT NULL,
    "subjectUserId" TEXT NOT NULL,
    "type" "ExceptionType" NOT NULL,
    "status" "ExceptionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "effectChange" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "evidenceLink" TEXT,
    "requestedByEmail" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attestedByEmail" TEXT,
    "attestedAt" TIMESTAMP(3),
    "reviewedByEmail" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "deniedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "ttlDays" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "decisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExceptionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReclamationEvent" (
    "id" TEXT NOT NULL,
    "subjectUserId" TEXT NOT NULL,
    "licenseId" TEXT,
    "trigger" "ReclamationTrigger" NOT NULL,
    "action" "ReclamationAction" NOT NULL,
    "state" "ReclamationState" NOT NULL DEFAULT 'NOTIFIED',
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "disputeWindowEndsAt" TIMESTAMP(3),
    "disputedAt" TIMESTAMP(3),
    "disputedByEmail" TEXT,
    "disputeReason" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByEmail" TEXT,
    "justification" TEXT NOT NULL,
    "decisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReclamationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetSnapshot" (
    "id" TEXT NOT NULL,
    "product" "Product" NOT NULL,
    "subTier" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "totalUsd" DOUBLE PRECISION NOT NULL,
    "requestCount" INTEGER NOT NULL,
    "userCount" INTEGER NOT NULL,
    "capUsdMonth" DOUBLE PRECISION,
    "pctOfCap" DOUBLE PRECISION,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FrictionBudgetMetric" (
    "id" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "product" "Product",
    "totalRequests" INTEGER NOT NULL,
    "allowed" INTEGER NOT NULL,
    "prompted" INTEGER NOT NULL,
    "blocked" INTEGER NOT NULL,
    "downgraded" INTEGER NOT NULL,
    "frictionRate" DOUBLE PRECISION NOT NULL,
    "budgetCeiling" DOUBLE PRECISION,
    "pctOfBudget" DOUBLE PRECISION,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FrictionBudgetMetric_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- 4. Indexes for the new tables
-- ---------------------------------------------------------------------------

-- CreateIndex
CREATE INDEX "ExceptionRequest_subjectUserId_status_idx" ON "ExceptionRequest"("subjectUserId", "status");

-- CreateIndex
CREATE INDEX "ExceptionRequest_status_expiresAt_idx" ON "ExceptionRequest"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "ReclamationEvent_subjectUserId_state_idx" ON "ReclamationEvent"("subjectUserId", "state");

-- CreateIndex
CREATE INDEX "ReclamationEvent_state_disputeWindowEndsAt_idx" ON "ReclamationEvent"("state", "disputeWindowEndsAt");

-- CreateIndex
CREATE INDEX "BudgetSnapshot_periodStart_idx" ON "BudgetSnapshot"("periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetSnapshot_product_subTier_periodStart_key" ON "BudgetSnapshot"("product", "subTier", "periodStart");

-- CreateIndex
CREATE INDEX "FrictionBudgetMetric_periodStart_idx" ON "FrictionBudgetMetric"("periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "FrictionBudgetMetric_product_periodStart_key" ON "FrictionBudgetMetric"("product", "periodStart");

-- ---------------------------------------------------------------------------
-- 5. Foreign keys for the new tables
-- ---------------------------------------------------------------------------

-- AddForeignKey
ALTER TABLE "ExceptionRequest" ADD CONSTRAINT "ExceptionRequest_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionRequest" ADD CONSTRAINT "ExceptionRequest_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReclamationEvent" ADD CONSTRAINT "ReclamationEvent_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReclamationEvent" ADD CONSTRAINT "ReclamationEvent_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "License"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReclamationEvent" ADD CONSTRAINT "ReclamationEvent_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
