/**
 * Pull OpenAI organization audit logs → ProgramVendorExportSnapshot + Decision ledger.
 */

import { DecisionType, type PrismaClient } from "@prisma/client";
import { getIntegrationMode, type IntegrationEnv } from "../env";
import { fetchOpenAiAuditLogsSince, type OpenAiAuditLogEvent } from "./admin-audit-logs";

export const OPENAI_ADMIN_AUDIT_SNAPSHOT_KIND = "OPENAI_ADMIN_AUDIT_LOGS" as const;
export const OPENAI_ADMIN_AUDIT_SYNC_STATE_KIND = "OPENAI_ADMIN_AUDIT_SYNC_STATE" as const;

const DEFAULT_LOOKBACK_DAYS = 7;
const MAX_EVENTS_PER_SNAPSHOT = 500;

export type OpenAiAdminAuditSyncResult = {
  ok: boolean;
  reason?: string;
  eventsFetched: number;
  eventsNew: number;
  snapshotsWritten: number;
  lastEffectiveAt: number | null;
};

type SyncState = {
  version: 1;
  lastEffectiveAt: number | null;
  recentEventIds: string[];
};

async function loadSyncState(prisma: PrismaClient): Promise<SyncState> {
  const row = await prisma.programVendorExportSnapshot.findFirst({
    where: { kind: OPENAI_ADMIN_AUDIT_SYNC_STATE_KIND },
    orderBy: { createdAt: "desc" },
    select: { payload: true },
  });
  const p = row?.payload as Partial<SyncState> | null;
  return {
    version: 1,
    lastEffectiveAt: typeof p?.lastEffectiveAt === "number" ? p.lastEffectiveAt : null,
    recentEventIds: Array.isArray(p?.recentEventIds)
      ? p.recentEventIds.filter((id): id is string => typeof id === "string")
      : [],
  };
}

async function saveSyncState(
  prisma: PrismaClient,
  state: SyncState,
  actorEmail: string,
): Promise<void> {
  await prisma.programVendorExportSnapshot.create({
    data: {
      kind: OPENAI_ADMIN_AUDIT_SYNC_STATE_KIND,
      filename: "openai-admin-audit-sync-state.json",
      rowCount: state.recentEventIds.length,
      actorEmail,
      payload: state,
    },
  });
}

function filterNewEvents(events: OpenAiAuditLogEvent[], seen: Set<string>): OpenAiAuditLogEvent[] {
  return events.filter((e) => !seen.has(e.id));
}

export async function syncOpenAiAdminAuditLogs(
  prisma: PrismaClient,
  args: {
    actorEmail: string;
    env?: IntegrationEnv;
    lookbackDays?: number;
    skipDecision?: boolean;
    fetchImpl?: typeof fetch;
  },
): Promise<OpenAiAdminAuditSyncResult> {
  const empty: OpenAiAdminAuditSyncResult = {
    ok: false,
    eventsFetched: 0,
    eventsNew: 0,
    snapshotsWritten: 0,
    lastEffectiveAt: null,
  };

  const env = args.env ?? process.env;
  if (getIntegrationMode("openai", env) !== "real") {
    return { ...empty, reason: "INTEGRATION_OPENAI is not real" };
  }

  const lookbackDays = Math.min(Math.max(args.lookbackDays ?? DEFAULT_LOOKBACK_DAYS, 1), 31);
  const state = await loadSyncState(prisma);
  const seen = new Set(state.recentEventIds);
  const floorMs =
    state.lastEffectiveAt != null
      ? state.lastEffectiveAt
      : Date.now() - lookbackDays * 86_400_000;

  let events: OpenAiAuditLogEvent[];
  try {
    events = await fetchOpenAiAuditLogsSince({
      env,
      effectiveAtGte: Math.floor(floorMs / 1000),
      fetchImpl: args.fetchImpl,
    });
  } catch (e) {
    return {
      ...empty,
      reason: e instanceof Error ? e.message : String(e),
    };
  }

  const newEvents = filterNewEvents(events, seen);
  let lastEffectiveAt = state.lastEffectiveAt;
  for (const ev of newEvents) {
    if (ev.effective_at != null) {
      lastEffectiveAt =
        lastEffectiveAt == null ? ev.effective_at : Math.max(lastEffectiveAt, ev.effective_at);
    }
  }

  let snapshotsWritten = 0;
  if (newEvents.length > 0) {
    const chunk = newEvents.slice(0, MAX_EVENTS_PER_SNAPSHOT);
    const now = new Date();
    await prisma.programVendorExportSnapshot.create({
      data: {
        kind: OPENAI_ADMIN_AUDIT_SNAPSHOT_KIND,
        filename: `openai-admin-audit-${now.toISOString().slice(0, 10)}.json`,
        periodStart: now,
        periodEnd: now,
        rowCount: chunk.length,
        actorEmail: args.actorEmail,
        payload: {
          source: "openai_admin_audit_logs_api",
          ingestedAt: now.toISOString(),
          events: chunk.map((e) => ({
            id: e.id,
            type: e.type,
            effective_at: e.effective_at,
            actor_email: e.actor?.email ?? null,
            ip_address: e.ip_address ?? null,
            user_agent: e.user_agent ?? null,
          })),
        },
      },
    });
    snapshotsWritten = 1;
  }

  const recentEventIds = [...seen, ...newEvents.map((e) => e.id)].slice(-2000);
  await saveSyncState(
    prisma,
    { version: 1, lastEffectiveAt, recentEventIds },
    args.actorEmail,
  );

  if (!args.skipDecision && newEvents.length > 0) {
    const typeCounts = new Map<string, number>();
    for (const ev of newEvents) {
      typeCounts.set(ev.type, (typeCounts.get(ev.type) ?? 0) + 1);
    }
    await prisma.decision.create({
      data: {
        type: DecisionType.OPENAI_ADMIN_AUDIT_SYNC,
        beforeState: JSON.stringify({
          lastEffectiveAt: state.lastEffectiveAt,
          seenCount: seen.size,
        }),
        afterState: JSON.stringify({
          eventsFetched: events.length,
          eventsNew: newEvents.length,
          lastEffectiveAt,
          topEventTypes: [...typeCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
            .map(([type, count]) => ({ type, count })),
        }),
        actorEmail: args.actorEmail,
        justification: `OpenAI Admin audit log sync ingested ${newEvents.length} new event(s).`,
      },
    });
  }

  return {
    ok: true,
    eventsFetched: events.length,
    eventsNew: newEvents.length,
    snapshotsWritten,
    lastEffectiveAt,
  };
}
