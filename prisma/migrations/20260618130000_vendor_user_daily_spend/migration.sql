-- CreateTable
CREATE TABLE "VendorUserDailySpend" (
    "id" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "product" "Product" NOT NULL,
    "day" DATE NOT NULL,
    "userEmail" TEXT NOT NULL,
    "spendUsd" DOUBLE PRECISION NOT NULL,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorUserDailySpend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VendorUserDailySpend_product_day_idx" ON "VendorUserDailySpend"("product", "day");

-- CreateIndex
CREATE INDEX "VendorUserDailySpend_userEmail_day_idx" ON "VendorUserDailySpend"("userEmail", "day");

-- CreateIndex
CREATE UNIQUE INDEX "VendorUserDailySpend_vendor_product_day_userEmail_key" ON "VendorUserDailySpend"("vendor", "product", "day", "userEmail");
