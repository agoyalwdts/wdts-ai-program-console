/**
 * Feed guardrail monitor from Cursor Team Admin filtered-usage-events
 * when INTEGRATION_CURSOR=real (no gateway mirror required for Cursor).
 */

import { Product } from "@prisma/client";
import { getIntegrationMode, type IntegrationEnv } from "@/lib/integrations/env";
import {
  fetchCursorFilteredUsageEventsInRange,
  resolveCursorTeamAdminApiKey,
} from "@/lib/integrations/cursor/team-admin-usage";
import type { Fetch } from "@/lib/integrations/_http";
import { mapFilteredUsageEventToParsedRow } from "@/lib/cursor-usage/map-filtered-usage-event";

export type GuardrailMonitorUsageRow = {
  ts: Date;
  product: Product;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
  decision: string;
  region: string;
  costUsd: number | null;
  userEmail: string | null;
  maxMode?: boolean;
};

export type CursorGuardrailFeedResult =
  | {
      active: true;
      eventsFetched: number;
      rowsInWindow: number;
      rows: GuardrailMonitorUsageRow[];
    }
  | {
      active: false;
      eventsFetched: 0;
      rowsInWindow: 0;
      rows: [];
      reason: string;
    };

export function mapCursorParsedRowToGuardrailUsage(
  row: NonNullable<ReturnType<typeof mapFilteredUsageEventToParsedRow>>,
): GuardrailMonitorUsageRow {
  const tokensIn = row.inputNoCache + row.inputCacheWrite;
  return {
    ts: row.occurredAt,
    product: Product.CURSOR,
    model: row.model,
    tokensIn: tokensIn > 0 ? tokensIn : null,
    tokensOut: row.outputTokens > 0 ? row.outputTokens : null,
    decision: "ALLOWED",
    region: "global",
    costUsd: row.costUsd,
    userEmail: row.userEmail,
    maxMode: row.maxMode,
  };
}

export async function loadCursorUsageForGuardrailMonitor(args: {
  since: Date;
  env?: IntegrationEnv;
  fetchImpl?: Fetch;
}): Promise<CursorGuardrailFeedResult> {
  const env = args.env ?? process.env;
  const mode = getIntegrationMode("cursor", env);
  if (mode !== "real") {
    return {
      active: false,
      eventsFetched: 0,
      rowsInWindow: 0,
      rows: [],
      reason: "INTEGRATION_CURSOR is not real",
    };
  }
  const apiKey = resolveCursorTeamAdminApiKey(env);
  if (!apiKey) {
    return {
      active: false,
      eventsFetched: 0,
      rowsInWindow: 0,
      rows: [],
      reason: "Cursor Team Admin API key unset",
    };
  }

  const sinceMs = args.since.getTime();
  const endMs = Date.now();
  if (sinceMs >= endMs) {
    return { active: true, eventsFetched: 0, rowsInWindow: 0, rows: [] };
  }

  const events = await fetchCursorFilteredUsageEventsInRange({
    startMs: sinceMs,
    endMs,
    opts: { apiKey, fetchImpl: args.fetchImpl },
    pageSize: 500,
  });

  const rows: GuardrailMonitorUsageRow[] = [];
  for (const ev of events) {
    const parsed = mapFilteredUsageEventToParsedRow(ev);
    if (!parsed) continue;
    if (parsed.occurredAt.getTime() < sinceMs) continue;
    rows.push(mapCursorParsedRowToGuardrailUsage(parsed));
  }

  return {
    active: true,
    eventsFetched: events.length,
    rowsInWindow: rows.length,
    rows,
  };
}
