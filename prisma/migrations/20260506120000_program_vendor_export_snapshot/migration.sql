-- AlterEnum
ALTER TYPE "DecisionType" ADD VALUE 'PROGRAM_VENDOR_EXPORT_IMPORT';

-- CreateTable
CREATE TABLE "ProgramVendorExportSnapshot" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "periodStart" DATE,
    "periodEnd" DATE,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgramVendorExportSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProgramVendorExportSnapshot_kind_createdAt_idx" ON "ProgramVendorExportSnapshot"("kind", "createdAt");
