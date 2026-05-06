/**
 * Pull Cursor Admin {@link https://cursor.com/docs/account/teams/admin-api#get-usage-events-data filtered-usage-events}
 * and run the same prudence rules as CSV ingest.
 */

import type { PrismaClient } from "@prisma/client";
import { getIntegrationMode, type IntegrationEnv } from "@/lib/integrations/env";
import {
  fetchCursorFilteredUsageEventsInRange,
  resolveCursorTeamAdminApiKey,
} from "@/lib/integrations/cursor/team-admin-usage";
import type { Fetch } from "@/lib/integrations/_http";
import { mapFilteredUsageEventToParsedRow } from "./map-filtered-usage-event";
import { buildPrudenceCandidates, persistCursorPrudenceIngest } from "./persist-prudence-ingest";

export type SyncCursorPrudenceFromApiResult =
  | {
      ok: true;
      dryRun: boolean;
      eventsFetched: number;
      rowsMapped: number;
      alertsWouldCreate?: number;
      alertsInserted?: number;
      candidatesEvaluated?: number;
      sample?: ReturnType<typeof buildPrudenceCandidates>;
    }
  | { ok: false; error: string };

const SOURCE_LABEL = "api:filtered-usage-events";

export async function syncCursorPrudenceFromFilteredUsageApi(args: {
  prisma: PrismaClient;
  env?: IntegrationEnv;
  fetchImpl?: Fetch;
  lookbackDays: number;
  dryRun: boolean;
  actorEmail: string;
  dashboardBaseUrl: string;
}): Promise<SyncCursorPrudenceFromApiResult> {
  const env = args.env ?? process.env;
  const mode = getIntegrationMode("cursor", env);
  const apiKey = resolveCursorTeamAdminApiKey(env);
  if (mode !== "real") {
    return { ok: false, error: "INTEGRATION_CURSOR must be `real` for API prudence sync." };
  }
  if (!apiKey) {
    return {
      ok: false,
      error:
        "No Team Admin API key (set CURSOR_TEAM_ADMIN_API_KEY or CURSOR_ADMIN_TOKEN).",
    };
  }

  const lookbackDays = Math.min(Math.max(args.lookbackDays, 1), 30);
  const endMs = Date.now();
  const startMs = endMs - lookbackDays * 24 * 60 * 60 * 1000;

  const events = await fetchCursorFilteredUsageEventsInRange({
    startMs,
    endMs,
    opts: { apiKey, fetchImpl: args.fetchImpl },
    pageSize: 500,
  });

  const rows = events
    .map((ev) => mapFilteredUsageEventToParsedRow(ev))
    .filter((r): r is NonNullable<typeof r> => r != null);

  const candidates = buildPrudenceCandidates(rows);

  if (args.dryRun) {
    return {
      ok: true,
      dryRun: true,
      eventsFetched: events.length,
      rowsMapped: rows.length,
      alertsWouldCreate: candidates.length,
      sample: candidates.slice(0, 15),
    };
  }

  const persisted = await persistCursorPrudenceIngest({
    prisma: args.prisma,
    candidates,
    rowsEvaluated: rows.length,
    actorEmail: args.actorEmail,
    sourceFilename: SOURCE_LABEL,
    justificationSummary: `Cursor team-usage prudence API ingest (${SOURCE_LABEL}, last ${lookbackDays}d)`,
    dashboardBaseUrl: args.dashboardBaseUrl,
  });

  return {
    ok: true,
    dryRun: false,
    eventsFetched: events.length,
    rowsMapped: rows.length,
    alertsInserted: persisted.alertsInserted,
    candidatesEvaluated: persisted.candidatesEvaluated,
  };
}
