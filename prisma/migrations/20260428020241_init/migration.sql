-- Initial baseline migration for the v0.1 schema (User, License, UsageRecord,
-- Decision). Replaces the `prisma db push` workflow used during the v0.1
-- prototype build. v0.2 adds ExceptionRequest, ReclamationEvent,
-- BudgetSnapshot, FrictionBudgetMetric in subsequent migrations.
-- Refs: Dashboard_Scoping_v1.md §3.1; .cursor/rules/prisma-changes.mdc.

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "managerId" TEXT,
    "roleTag" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "License" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "subTier" TEXT NOT NULL,
    "capUsdMonth" DOUBLE PRECISION,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'AUTO_PROVISIONED',
    "flag" TEXT,

    CONSTRAINT "License_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "costUsd" DOUBLE PRECISION,
    "decision" TEXT NOT NULL DEFAULT 'ALLOWED',
    "region" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subjectUserId" TEXT,
    "beforeState" TEXT NOT NULL,
    "afterState" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "evidenceLink" TEXT,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "License_product_subTier_idx" ON "License"("product", "subTier");

-- CreateIndex
CREATE UNIQUE INDEX "License_userId_product_key" ON "License"("userId", "product");

-- CreateIndex
CREATE INDEX "UsageRecord_userId_ts_idx" ON "UsageRecord"("userId", "ts");

-- CreateIndex
CREATE INDEX "UsageRecord_product_ts_idx" ON "UsageRecord"("product", "ts");

-- CreateIndex
CREATE INDEX "Decision_type_ts_idx" ON "Decision"("type", "ts");

-- CreateIndex
CREATE INDEX "Decision_ts_idx" ON "Decision"("ts");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "License" ADD CONSTRAINT "License_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
