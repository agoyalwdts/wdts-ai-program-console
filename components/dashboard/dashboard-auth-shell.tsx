import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadFreshnessSummary, refreshDashboardMirrors } from "@/lib/sync";
import { isDashboardSyncForceFromRequest } from "@/lib/sync/page-load-request";
import { UserSessionProvider } from "@/components/dashboard/user-session-provider";
import { SyncFreshnessBar } from "@/components/dashboard/sync-freshness-bar";

/** Resolves session once per layout mount; runs hot-tier delta sync when stale. */
export async function DashboardAuthShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const forceRefresh = await isDashboardSyncForceFromRequest();

  const refreshResult = await refreshDashboardMirrors(prisma, {
    trigger: "page_load",
    actorEmail: user.email,
    tiers: ["hot"],
    maxWaitMs: 15_000,
    force: forceRefresh,
  });

  const freshness = await loadFreshnessSummary(prisma);
  freshness.refreshResult = refreshResult;

  return (
    <UserSessionProvider user={user}>
      <div className="flex min-h-0 flex-1 flex-col min-w-0">
        <SyncFreshnessBar summary={freshness} />
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </div>
    </UserSessionProvider>
  );
}
