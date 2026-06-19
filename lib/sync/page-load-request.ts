/** Request header set by proxy when `?refresh=1` is present on a dashboard URL. */
export const DASHBOARD_SYNC_FORCE_HEADER = "x-dashboard-sync-force";

export function parseSyncForceParam(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

/** True when proxy stamped {@link DASHBOARD_SYNC_FORCE_HEADER} for this navigation. */
export async function isDashboardSyncForceFromRequest(): Promise<boolean> {
  const { headers } = await import("next/headers");
  const headerList = await headers();
  return headerList.get(DASHBOARD_SYNC_FORCE_HEADER) === "1";
}
