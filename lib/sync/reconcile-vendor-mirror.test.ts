import { Product } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { CODEX_ENTERPRISE_ANALYTICS_VENDOR_KEY } from "@/lib/integrations/codex-enterprise-analytics/fetch-workspace-usage";
import { reconcileVendorMirrorAfterTimeout } from "./reconcile-vendor-mirror";

describe("reconcileVendorMirrorAfterTimeout", () => {
  it("reconciles when mirror syncedAt is within the attempt window", async () => {
    const started = Date.now();
    const syncedAt = new Date(started + 500);
    const prisma = {
      vendorDailySpend: {
        findFirst: async () => ({ syncedAt }),
      },
    } as never;

    const result = await reconcileVendorMirrorAfterTimeout(
      prisma,
      "codex_enterprise_spend",
      started,
    );
    expect(result.reconciled).toBe(true);
  });

  it("does not reconcile stale mirror rows", async () => {
    const started = Date.now();
    const syncedAt = new Date(started - 60_000);
    const prisma = {
      vendorDailySpend: {
        findFirst: async () => ({ syncedAt }),
      },
    } as never;

    const result = await reconcileVendorMirrorAfterTimeout(
      prisma,
      "codex_enterprise_spend",
      started,
    );
    expect(result.reconciled).toBe(false);
  });

  it("queries codex vendor key", async () => {
    let vendor = "";
    const prisma = {
      vendorDailySpend: {
        findFirst: async (args: { where: { vendor: string; product: Product } }) => {
          vendor = args.where.vendor;
          return null;
        },
      },
    } as never;

    await reconcileVendorMirrorAfterTimeout(prisma, "codex_enterprise_spend", Date.now());
    expect(vendor).toBe(CODEX_ENTERPRISE_ANALYTICS_VENDOR_KEY);
  });
});
