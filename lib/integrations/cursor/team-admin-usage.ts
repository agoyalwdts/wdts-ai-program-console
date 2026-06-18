/**
 * Cursor Team Admin API — usage events with billable cents.
 *
 * Docs: https://cursor.com/docs/account/teams/admin-api
 * POST https://api.cursor.com/teams/filtered-usage-events
 * Auth: Basic (API key as username, empty password).
 *
 * Sums `chargedCents` → USD. Cursor documents this field as **cents** (possibly
 * fractional); USD is always `chargedCents / 100` (reconciles with /teams/spend).
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

/** Token block on token-billed usage events (Admin API). */
export type CursorTokenUsagePayload = {
  inputTokens?: number;
  outputTokens?: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
  totalCents?: number;
  discountPercentOff?: number;
};

/** Full event shape from POST /teams/filtered-usage-events (superset of vendor rollup fields). */
export type CursorFilteredUsageEventFull = {
  timestamp: string;
  userEmail?: string;
  model?: string;
  kind?: string;
  maxMode?: boolean;
  requestsCosts?: number;
  isTokenBasedCall?: boolean;
  isChargeable?: boolean;
  isHeadless?: boolean;
  tokenUsage?: CursorTokenUsagePayload;
  chargedCents?: number | string;
  cursorTokenFee?: number;
  isFreeBugbot?: boolean;
};

/**
 * Cursor Admin API: `chargedCents` is “total amount charged **in cents**” for the event, including
 * fractional values in examples ({@link https://cursor.com/docs/account/teams/admin-api } e.g.
 * `21.36232`, `37.33`). USD is always cents ÷ 100 — treating non-integers as dollars was a ~100×
 * inflation bug on MTD sums. Numeric strings from JSON are coerced with {@link Number}.
 */
export function cursorChargedFieldToUsd(
  chargedCents: number | string | undefined | null,
): number {
  if (chargedCents == null) return 0;
  const n = typeof chargedCents === "number" ? chargedCents : Number(chargedCents);
  if (!Number.isFinite(n)) return 0;
  return n / 100;
}

type FilteredUsagePage = {
  usageEvents: CursorFilteredUsageEventFull[];
  pagination: {
    currentPage: number;
    pageSize: number;
    numPages: number;
    hasNextPage: boolean;
  };
};

/** Max window per request — Cursor limits some team endpoints to 30 days; stay under. */
export const CURSOR_USAGE_CHUNK_MS = 25 * 24 * 60 * 60 * 1000;

/** Space out pagination calls to avoid burst 429s from Cursor's API. */
const INTER_REQUEST_MS = 250;

/** Retries per page when Cursor returns 429 (Retry-After or exponential backoff). */
const RATE_LIMIT_MAX_ATTEMPTS = 8;

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Cloud Agents API v1 (`/v1/me`, `/v1/agents`, …) requires a key from Dashboard → Integrations
 * (or a service account key). Admin / SCIM tokens return 401 on these paths.
 */
export function resolveCursorCloudAgentsApiKey(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const k =
    env.CURSOR_CLOUD_AGENTS_API_KEY?.trim() || env.CURSOR_INTEGRATIONS_API_KEY?.trim();
  return k || null;
}

export function resolveCursorTeamAdminApiKey(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const k =
    env.CURSOR_TEAM_ADMIN_API_KEY?.trim() || env.CURSOR_ADMIN_TOKEN?.trim();
  return k || null;
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

export type CursorUsageAggregates = {
  byDay: Map<string, DailyBucket>;
  /** ymd → normalized email → bucket */
  byDayUser: Map<string, Map<string, DailyBucket>>;
};

export function normCursorUserEmail(email: string | undefined): string | null {
  if (!email?.trim()) return null;
  const e = email.trim().toLowerCase();
  return e.includes("@") ? e : null;
}

export function aggregateCursorUsageEvents(
  events: CursorFilteredUsageEventFull[],
): CursorUsageAggregates {
  const byDay = new Map<string, DailyBucket>();
  const byDayUser = new Map<string, Map<string, DailyBucket>>();

  for (const ev of events) {
    const ms = Number(ev.timestamp);
    if (!Number.isFinite(ms)) continue;
    const ymd = calendarYmdFromMillis(ms);
    const usd = cursorChargedFieldToUsd(ev.chargedCents);

    const dayPrev = byDay.get(ymd) ?? { spendUsd: 0, eventCount: 0 };
    dayPrev.spendUsd += usd;
    dayPrev.eventCount += 1;
    byDay.set(ymd, dayPrev);

    const email = normCursorUserEmail(ev.userEmail);
    if (!email) continue;
    let userMap = byDayUser.get(ymd);
    if (!userMap) {
      userMap = new Map();
      byDayUser.set(ymd, userMap);
    }
    const userPrev = userMap.get(email) ?? { spendUsd: 0, eventCount: 0 };
    userPrev.spendUsd += usd;
    userPrev.eventCount += 1;
    userMap.set(email, userPrev);
  }

  return { byDay, byDayUser };
}

async function postFilteredUsageEventsPage(args: {
  chunkStart: number;
  chunkEnd: number;
  page: number;
  pageSize: number;
  auth: string;
  fetchImpl: typeof fetch;
}): Promise<FilteredUsagePage> {
  const { chunkStart, chunkEnd, page, pageSize, auth, fetchImpl } = args;
  let res!: Response;
  let text!: string;
  let nextBackoffMs = 2000;
  for (let attempt = 0; attempt < RATE_LIMIT_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(nextBackoffMs);
    }
    res = await fetchImpl(`${CURSOR_TEAM_ADMIN_API_BASE}/teams/filtered-usage-events`, {
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
    text = await res.text();
    if (res.status === 429) {
      const ra = res.headers.get("retry-after");
      const sec = ra ? Number.parseInt(ra, 10) : NaN;
      nextBackoffMs =
        Number.isFinite(sec) && sec > 0
          ? Math.min(120_000, sec * 1000)
          : Math.min(60_000, 2000 * 2 ** attempt);
      continue;
    }
    break;
  }
  if (res.status === 429) {
    throw new IntegrationError(
      "cursor",
      `POST /teams/filtered-usage-events → 429: rate limit (exhausted ${RATE_LIMIT_MAX_ATTEMPTS} retries): ${text.slice(0, 400)}`,
    );
  }
  if (!res.ok) {
    throw new IntegrationError(
      "cursor",
      `POST /teams/filtered-usage-events → ${res.status}: ${text.slice(0, 600)}`,
    );
  }
  try {
    return JSON.parse(text) as FilteredUsagePage;
  } catch {
    throw new IntegrationError("cursor", "filtered-usage-events: invalid JSON body");
  }
}

/**
 * Fetch every usage event in [startMs, endMs], chunking and paginating per Admin API limits.
 */
export async function fetchCursorFilteredUsageEventsInRange(args: {
  startMs: number;
  endMs: number;
  opts: CursorTeamAdminUsageOpts;
  pageSize?: number;
}): Promise<CursorFilteredUsageEventFull[]> {
  const { startMs, endMs, opts } = args;
  const pageSize = Math.min(Math.max(args.pageSize ?? 500, 1), 500);
  const f = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const auth = Buffer.from(`${opts.apiKey}:`).toString("base64");
  const out: CursorFilteredUsageEventFull[] = [];

  let chunkStart = startMs;
  while (chunkStart <= endMs) {
    const chunkEnd = Math.min(chunkStart + CURSOR_USAGE_CHUNK_MS - 1, endMs);
    let page = 1;
    for (let guard = 0; guard < 5000; guard++) {
      if (page > 1) {
        await sleep(INTER_REQUEST_MS);
      }
      const body = await postFilteredUsageEventsPage({
        chunkStart,
        chunkEnd,
        page,
        pageSize,
        auth,
        fetchImpl: f,
      });
      out.push(...(body.usageEvents ?? []));
      if (body.pagination?.hasNextPage !== true) break;
      page += 1;
    }
    chunkStart = chunkEnd + 1;
  }
  return out;
}

/**
 * Fetch all usage events in [startMs, endMs], paginating each chunk.
 * Aggregates by UTC calendar day.
 */
export async function fetchCursorFilteredUsageByUtcDay(args: {
  startMs: number;
  endMs: number;
  opts: CursorTeamAdminUsageOpts;
}): Promise<Map<string, DailyBucket>> {
  const events = await fetchCursorFilteredUsageEventsInRange(args);
  return aggregateCursorUsageEvents(events).byDay;
}
