-- Cursor team-usage prudence alerts (CSV ingest). Dashboard-owned.

ALTER TYPE "DecisionType" ADD VALUE 'CURSOR_USAGE_PRUDENCE_INGEST';

CREATE TABLE "CursorUsagePrudenceAlert" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rowOccurredAt" TIMESTAMP(3) NOT NULL,
    "userEmail" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "maxMode" TEXT NOT NULL,
    "inputCacheWrite" INTEGER NOT NULL,
    "inputNoCache" INTEGER NOT NULL,
    "cacheRead" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "costUsd" DOUBLE PRECISION NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "sourceFilename" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "emailNotifiedAt" TIMESTAMP(3),

    CONSTRAINT "CursorUsagePrudenceAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CursorUsagePrudenceAlert_dedupeKey_key" ON "CursorUsagePrudenceAlert"("dedupeKey");
CREATE INDEX "CursorUsagePrudenceAlert_userEmail_rowOccurredAt_idx" ON "CursorUsagePrudenceAlert"("userEmail", "rowOccurredAt");
CREATE INDEX "CursorUsagePrudenceAlert_acknowledgedAt_idx" ON "CursorUsagePrudenceAlert"("acknowledgedAt");
CREATE INDEX "CursorUsagePrudenceAlert_createdAt_idx" ON "CursorUsagePrudenceAlert"("createdAt");
