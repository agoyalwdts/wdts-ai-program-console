import type { PrismaClient } from "@prisma/client";
import type { WorkspaceAnalyticsEventType } from "./event-types";
import { WORKSPACE_ANALYTICS_SYNC_STATE_KIND } from "./event-types";
import type { WorkspaceAnalyticsSyncState } from "./types";

const MAX_RECENT_EVENT_IDS = 8_000;
const MAX_RECENT_LOG_FILE_IDS = 500;

export function emptySyncState(): WorkspaceAnalyticsSyncState {
  return { version: 1, byEventType: {} };
}

export function trimSyncState(state: WorkspaceAnalyticsSyncState): WorkspaceAnalyticsSyncState {
  const byEventType = { ...state.byEventType };
  for (const key of Object.keys(byEventType) as WorkspaceAnalyticsEventType[]) {
    const entry = byEventType[key];
    if (!entry) continue;
    byEventType[key] = {
      lastEndTime: entry.lastEndTime,
      recentEventIds: entry.recentEventIds.slice(-MAX_RECENT_EVENT_IDS),
      recentLogFileIds: entry.recentLogFileIds.slice(-MAX_RECENT_LOG_FILE_IDS),
    };
  }
  return { version: 1, byEventType };
}

export async function loadWorkspaceAnalyticsSyncState(
  prisma: PrismaClient,
): Promise<WorkspaceAnalyticsSyncState> {
  const row = await prisma.programVendorExportSnapshot.findFirst({
    where: { kind: WORKSPACE_ANALYTICS_SYNC_STATE_KIND },
    orderBy: { createdAt: "desc" },
    select: { payload: true },
  });
  if (!row?.payload || typeof row.payload !== "object") {
    return emptySyncState();
  }
  const p = row.payload as WorkspaceAnalyticsSyncState;
  if (p.version !== 1 || !p.byEventType) return emptySyncState();
  return trimSyncState(p);
}

export async function saveWorkspaceAnalyticsSyncState(
  prisma: PrismaClient,
  state: WorkspaceAnalyticsSyncState,
  actorEmail: string,
): Promise<void> {
  const trimmed = trimSyncState(state);
  await prisma.programVendorExportSnapshot.create({
    data: {
      kind: WORKSPACE_ANALYTICS_SYNC_STATE_KIND,
      filename: "workspace-analytics-sync-state.json",
      periodStart: null,
      periodEnd: null,
      rowCount: 0,
      actorEmail,
      payload: trimmed,
    },
  });
}

export function rememberEventId(
  state: WorkspaceAnalyticsSyncState,
  eventType: WorkspaceAnalyticsEventType,
  eventId: string,
): void {
  const entry = state.byEventType[eventType] ?? {
    lastEndTime: null,
    recentEventIds: [],
    recentLogFileIds: [],
  };
  if (!entry.recentEventIds.includes(eventId)) {
    entry.recentEventIds.push(eventId);
  }
  state.byEventType[eventType] = entry;
}

export function hasSeenEventId(
  state: WorkspaceAnalyticsSyncState,
  eventType: WorkspaceAnalyticsEventType,
  eventId: string,
): boolean {
  return state.byEventType[eventType]?.recentEventIds.includes(eventId) ?? false;
}

export function rememberLogFileId(
  state: WorkspaceAnalyticsSyncState,
  eventType: WorkspaceAnalyticsEventType,
  logFileId: string,
): void {
  const entry = state.byEventType[eventType] ?? {
    lastEndTime: null,
    recentEventIds: [],
    recentLogFileIds: [],
  };
  if (!entry.recentLogFileIds.includes(logFileId)) {
    entry.recentLogFileIds.push(logFileId);
  }
  state.byEventType[eventType] = entry;
}

export function hasSeenLogFileId(
  state: WorkspaceAnalyticsSyncState,
  eventType: WorkspaceAnalyticsEventType,
  logFileId: string,
): boolean {
  return state.byEventType[eventType]?.recentLogFileIds.includes(logFileId) ?? false;
}
