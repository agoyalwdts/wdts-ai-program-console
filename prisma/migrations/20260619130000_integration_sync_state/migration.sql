-- Dashboard incremental sync ledger (ADR 0007).
CREATE TABLE "IntegrationSyncState" (
    "key" TEXT NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastTrigger" TEXT,
    "lastError" TEXT,
    "lastSummary" JSONB,

    CONSTRAINT "IntegrationSyncState_pkey" PRIMARY KEY ("key")
);
