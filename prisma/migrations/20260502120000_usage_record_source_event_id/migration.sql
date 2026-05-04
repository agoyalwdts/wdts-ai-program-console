-- Mirror pipeline: idempotent usage events from POST /api/webhooks/usage-ingest

ALTER TABLE "UsageRecord" ADD COLUMN "sourceEventId" TEXT;

CREATE UNIQUE INDEX "UsageRecord_sourceEventId_key" ON "UsageRecord"("sourceEventId");
