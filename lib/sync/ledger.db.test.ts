import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  getSyncLedgerRow,
  recordSyncFailure,
  recordSyncSuccess,
} from "@/lib/sync/ledger";

describe("IntegrationSyncState ledger", () => {
  const key = "cursor_vendor_spend";

  it("records success and failure", async () => {
    const stamp = `ledger-test-${Date.now()}@test`;
    await recordSyncSuccess(prisma, key, "page_load", { daysUpserted: 1 });
    let row = await getSyncLedgerRow(prisma, key);
    expect(row.lastSuccessAt).toBeTruthy();
    expect(row.lastTrigger).toBe("page_load");

    await recordSyncFailure(prisma, key, "cron", stamp);
    row = await getSyncLedgerRow(prisma, key);
    expect(row.lastError).toBe(stamp);
    expect(row.lastTrigger).toBe("cron");
  });
});
