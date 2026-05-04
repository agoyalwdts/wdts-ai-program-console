-- CreateTable
CREATE TABLE "VendorDailySpend" (
    "id" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "product" "Product" NOT NULL,
    "day" DATE NOT NULL,
    "spendUsd" DOUBLE PRECISION NOT NULL,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorDailySpend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorDailySpend_vendor_product_day_key" ON "VendorDailySpend"("vendor", "product", "day");

-- CreateIndex
CREATE INDEX "VendorDailySpend_product_day_idx" ON "VendorDailySpend"("product", "day");

-- AlterEnum
ALTER TYPE "DecisionType" ADD VALUE 'CURSOR_VENDOR_SPEND_SYNC';
