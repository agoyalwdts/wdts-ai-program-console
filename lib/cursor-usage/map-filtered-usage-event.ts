/**
 * Map Cursor Admin API {@link https://cursor.com/docs/account/teams/admin-api#get-usage-events-data filtered-usage-events}
 * payloads into {@link CursorUsageParsedRow} for shared prudence rules.
 */

import type { CursorUsageParsedRow } from "./types";
import {
  type CursorFilteredUsageEventFull,
  cursorChargedFieldToUsd,
} from "@/lib/integrations/cursor/team-admin-usage";

export { cursorChargedFieldToUsd } from "@/lib/integrations/cursor/team-admin-usage";

export function mapFilteredUsageEventToParsedRow(
  ev: CursorFilteredUsageEventFull,
): CursorUsageParsedRow | null {
  const ms = Number(ev.timestamp);
  if (!Number.isFinite(ms)) return null;
  const userEmail = (ev.userEmail ?? "").trim().toLowerCase();
  const model = (ev.model ?? "").trim();
  if (!userEmail || !model) return null;

  const tu = ev.tokenUsage;
  const cacheWrite = Math.max(0, Math.floor(tu?.cacheWriteTokens ?? 0));
  const inputTok = Math.max(0, Math.floor(tu?.inputTokens ?? 0));
  const inputNoCache = Math.max(0, inputTok - cacheWrite);
  const cacheRead = Math.max(0, Math.floor(tu?.cacheReadTokens ?? 0));
  const outputTokens = Math.max(0, Math.floor(tu?.outputTokens ?? 0));
  const totalTokens = inputTok + cacheRead + outputTokens;

  return {
    occurredAt: new Date(ms),
    userEmail,
    team: "",
    kind: (ev.kind ?? "").trim(),
    model,
    maxMode: Boolean(ev.maxMode),
    inputCacheWrite: cacheWrite,
    inputNoCache,
    cacheRead,
    outputTokens,
    totalTokens,
    costUsd: cursorChargedFieldToUsd(ev.chargedCents),
  };
}

