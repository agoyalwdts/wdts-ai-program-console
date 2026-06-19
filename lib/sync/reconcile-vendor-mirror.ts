import { Product, type PrismaClient } from "@prisma/client";
import { CODEX_ENTERPRISE_ANALYTICS_VENDOR_KEY } from "@/lib/integrations/codex-enterprise-analytics/fetch-workspace-usage";
import { CURSOR_TEAM_ADMIN_VENDOR_KEY } from "@/lib/integrations/cursor/team-admin-usage";
import type { SyncJobKey } from "./types";

const VENDOR_MIRROR_JOBS: Partial<
  Record<SyncJobKey, { vendor: string; product: Product }>
> = {
  codex_enterprise_spend: {
    vendor: CODEX_ENTERPRISE_ANALYTICS_VENDOR_KEY,
    product: Product.CODEX,
  },
  cursor_vendor_spend: {
    vendor: CURSOR_TEAM_ADMIN_VENDOR_KEY,
    product: Product.CURSOR,
  },
};

/**
 * When the orchestrator times out, vendor sync may still finish writing
 * VendorDailySpend. Treat a mirror update during this attempt as success.
 */
export async function reconcileVendorMirrorAfterTimeout(
  prisma: PrismaClient,
  key: SyncJobKey,
  attemptStartedMs: number,
): Promise<{ reconciled: true; syncedAt: Date } | { reconciled: false }> {
  const spec = VENDOR_MIRROR_JOBS[key];
  if (!spec) return { reconciled: false };

  const row = await prisma.vendorDailySpend.findFirst({
    where: { vendor: spec.vendor, product: spec.product },
    orderBy: { syncedAt: "desc" },
    select: { syncedAt: true },
  });

  if (!row?.syncedAt) return { reconciled: false };
  if (row.syncedAt.getTime() < attemptStartedMs - 1_000) return { reconciled: false };

  return { reconciled: true, syncedAt: row.syncedAt };
}
