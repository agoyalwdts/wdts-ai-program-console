/**
 * Cursor Team Admin API — usage events with billable cents.
 *
 * Docs: https://cursor.com/docs/account/teams/admin-api
 * POST https://api.cursor.com/teams/filtered-usage-events
 * Auth: Basic (API key as username, empty password).
 *
 * Sums `chargedCents` / 100 → USD per Cursor docs (reconciles with /teams/spend).
 */

import { IntegrationError } from "../errors";
import type { Fetch } from "../_http";

export const CURSOR_TEAM_ADMIN_API_BASE = "https://api.cursor.com";
export const CURSOR_TEAM_ADMIN_VENDOR_KEY = "CURSOR_TEAM_ADMIN_API" as const;

export type CursorTeamAdminUsageOpts = {
  /** Basic-auth API key (Team Admin key). */
  apiKey: string;
  fetchImpl?: Fetch;
};

export type FilteredUsageEvent = {
  timestamp: string;
  userEmail?: string;
  chargedCents?: number;
  model?: string;
};

type FilteredUsagePage = {
  usageEvents: FilteredUsageEvent[];
  pagination: {
    currentPage: number;
    pageSize: number;
    numPages: number;
    hasNextPage: boolean;
  };
};

/** Max window per request — Cursor limits some team endpoints to 30 days; stay under. */
export const CURSOR_USAGE_CHUNK_MS = 25 * 24 * 60 * 60 * 1000;

export function resolveCursorTeamAdminApiKey(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const k =
    env.CURSOR_TEAM_ADMIN_API_KEY?.trim() || env.CURSOR_ADMIN_TOKEN?.trim();
  return k || null;
}

function chargedUsd(ev: FilteredUsageEvent): number {
  const c = ev.chargedCents;
  if (c == null || !Number.isFinite(c)) return 0;
  return c / 100;
}

/** Calendar date key YYYY-MM-DD using the host local timezone (matches F1 daily chart buckets on the server). */
export function calendarYmdFromMillis(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type DailyBucket = { spendUsd: number; eventCount: number };

/**
 * Fetch all usage events in [startMs, endMs], paginating each chunk.
 * Aggregates by UTC calendar day.
 */
export async function fetchCursorFilteredUsageByUtcDay(args: {
  startMs: number;
  endMs: number;
  opts: CursorTeamAdminUsageOpts;
}): Promise<Map<string, DailyBucket>> {
  const { startMs, endMs, opts } = args;
  const out = new Map<string, DailyBucket>();
  const f = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const auth = Buffer.from(`${opts.apiKey}:`).toString("base64");

  let chunkStart = startMs;
  while (chunkStart <= endMs) {
    const chunkEnd = Math.min(chunkStart + CURSOR_USAGE_CHUNK_MS - 1, endMs);
    let page = 1;
    const pageSize = 500;
    for (let guard = 0; guard < 5000; guard++) {
      const res = await f(`${CURSOR_TEAM_ADMIN_API_BASE}/teams/filtered-usage-events`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          startDate: chunkStart,
          endDate: chunkEnd,
          page,
          pageSize,
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        throw new IntegrationError(
          "cursor",
          `POST /teams/filtered-usage-events → ${res.status}: ${text.slice(0, 600)}`,
        );
      }
      let body: FilteredUsagePage;
      try {
        body = JSON.parse(text) as FilteredUsagePage;
      } catch {
        throw new IntegrationError("cursor", "filtered-usage-events: invalid JSON body");
      }
      const events = body.usageEvents ?? [];
      for (const ev of events) {
        const ms = Number(ev.timestamp);
        if (!Number.isFinite(ms)) continue;
        const ymd = calendarYmdFromMillis(ms);
        const usd = chargedUsd(ev);
        const prev = out.get(ymd) ?? { spendUsd: 0, eventCount: 0 };
        prev.spendUsd += usd;
        prev.eventCount += 1;
        out.set(ymd, prev);
      }
      const hasNext = body.pagination?.hasNextPage === true;
      if (!hasNext) break;
      page += 1;
    }
    chunkStart = chunkEnd + 1;
  }
  return out;
}
