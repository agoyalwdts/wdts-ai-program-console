import type { PrismaClient } from "@prisma/client";
import { UNIFIED_CREDITS_SYNC_STATE_KIND } from "./constants";
import type { UnifiedCreditsSyncState } from "./types";

const MAX_RECENT_EVENT_IDS = 12_000;
const MAX_RECENT_LOG_FILE_IDS = 500;

export function emptyUnifiedCreditsSyncState(): UnifiedCreditsSyncState {
  return { version: 1, lastEndTime: null, recentEventIds: [], recentLogFileIds: [] };
}

export function trimUnifiedCreditsSyncState(state: UnifiedCreditsSyncState): UnifiedCreditsSyncState {
  return {
    version: 1,
    lastEndTime: state.lastEndTime,
    recentEventIds: state.recentEventIds.slice(-MAX_RECENT_EVENT_IDS),
    recentLogFileIds: state.recentLogFileIds.slice(-MAX_RECENT_LOG_FILE_IDS),
  };
}

export async function loadUnifiedCreditsSyncState(
  prisma: PrismaClient,
): Promise<UnifiedCreditsSyncState> {
  const row = await prisma.programVendorExportSnapshot.findFirst({
    where: { kind: UNIFIED_CREDITS_SYNC_STATE_KIND },
    orderBy: { createdAt: "desc" },
    select: { payload: true },
  });
  if (!row?.payload || typeof row.payload !== "object") {
    return emptyUnifiedCreditsSyncState();
  }
  const p = row.payload as UnifiedCreditsSyncState;
  if (p.version !== 1) return emptyUnifiedCreditsSyncState();
  return trimUnifiedCreditsSyncState(p);
}

export async function saveUnifiedCreditsSyncState(
  prisma: PrismaClient,
  state: UnifiedCreditsSyncState,
  actorEmail: string,
): Promise<void> {
  await prisma.programVendorExportSnapshot.create({
    data: {
      kind: UNIFIED_CREDITS_SYNC_STATE_KIND,
      filename: "unified-credits-sync-state.json",
      periodStart: null,
      periodEnd: null,
      rowCount: 0,
      actorEmail,
      payload: trimUnifiedCreditsSyncState(state),
    },
  });
}

export function rememberCostsEventId(state: UnifiedCreditsSyncState, eventId: string): void {
  if (!state.recentEventIds.includes(eventId)) state.recentEventIds.push(eventId);
}

export function hasSeenCostsEventId(state: UnifiedCreditsSyncState, eventId: string): boolean {
  return state.recentEventIds.includes(eventId);
}

export function rememberCostsLogFileId(state: UnifiedCreditsSyncState, logFileId: string): void {
  if (!state.recentLogFileIds.includes(logFileId)) state.recentLogFileIds.push(logFileId);
}

export function hasSeenCostsLogFileId(state: UnifiedCreditsSyncState, logFileId: string): boolean {
  return state.recentLogFileIds.includes(logFileId);
}
