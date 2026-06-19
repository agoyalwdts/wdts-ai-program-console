import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadFreshnessSummary, refreshDashboardMirrors } from "@/lib/sync";
import { UserSessionProvider } from "@/components/dashboard/user-session-provider";
import { SyncFreshnessBar } from "@/components/dashboard/sync-freshness-bar";

/** Resolves session once per layout mount; runs hot-tier delta sync when stale. */
export async function DashboardAuthShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  const refreshResult = await refreshDashboardMirrors(prisma, {
    trigger: "page_load",
    actorEmail: user.email,
    tiers: ["hot"],
    maxWaitMs: 15_000,
  });

  const freshness = await loadFreshnessSummary(prisma);
  freshness.refreshResult = refreshResult;

  return (
    <UserSessionProvider user={user}>
      <SyncFreshnessBar summary={freshness} />
      <main className="flex-1 min-w-0 flex flex-col">{children}</main>
    </UserSessionProvider>
  );
}
