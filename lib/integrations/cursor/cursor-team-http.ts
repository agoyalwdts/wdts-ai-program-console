/**
 * Shared Basic-auth JSON helpers for `https://api.cursor.com` (Team Admin,
 * Analytics, AI Code Tracking, Cloud Agents v1 — see https://cursor.com/docs/api).
 *
 * GET responses from Analytics + AI Code Tracking may include `ETag`; we cache
 * conditionally and send `If-None-Match` per vendor guidance (304 saves rate limit).
 */

import { IntegrationError } from "../errors";
import type { Fetch } from "../_http";
import { CURSOR_TEAM_ADMIN_API_BASE } from "./team-admin-usage";

const CURSOR_ETAG_TTL_MS = 15 * 60 * 1000;

type EtagCacheEntry = { etag: string; body: unknown; storedAt: number };
const cursorGetEtagCache = new Map<string, EtagCacheEntry>();

function etagCacheDisabled(): boolean {
  return process.env.NODE_ENV === "test" || process.env.VITEST === "true";
}

/** Test-only: clear in-memory ETag cache between Vitest cases. */
export function clearCursorTeamEtagCacheForTests(): void {
  cursorGetEtagCache.clear();
}

export function cursorTeamBasicAuthHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
}

function buildCursorUrl(path: string, query?: Record<string, string | number | undefined>): string {
  const u = new URL(path, CURSOR_TEAM_ADMIN_API_BASE);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === "") continue;
      u.searchParams.set(k, String(v));
    }
  }
  return u.toString();
}

export async function cursorTeamGetJson<T = unknown>(args: {
  path: string;
  query?: Record<string, string | number | undefined>;
  apiKey: string;
  fetchImpl?: Fetch;
  /** When false, skip ETag cache (default true outside test env). */
  useEtagCache?: boolean;
  /** When true, use ETag behaviour even under Vitest (for contract tests only). */
  forceEtagCache?: boolean;
}): Promise<T> {
  const f = args.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const url = buildCursorUrl(args.path, args.query);
  const useEtag =
    args.forceEtagCache === true || (args.useEtagCache !== false && !etagCacheDisabled());

  const now = Date.now();
  let ifNoneMatch: string | undefined;
  if (useEtag) {
    const hit = cursorGetEtagCache.get(url);
    if (hit && now - hit.storedAt < CURSOR_ETAG_TTL_MS) {
      ifNoneMatch = hit.etag;
    }
  }

  const res = await f(url, {
    method: "GET",
    headers: {
      Authorization: cursorTeamBasicAuthHeader(args.apiKey),
      Accept: "application/json",
      ...(ifNoneMatch ? { "If-None-Match": ifNoneMatch } : {}),
    },
  });

  if (res.status === 304) {
    const hit = cursorGetEtagCache.get(url);
    if (!hit) {
      throw new IntegrationError(
        "cursor",
        `GET ${args.path} → 304 Not Modified but no local cache entry`,
      );
    }
    return hit.body as T;
  }

  const text = await res.text();
  if (!res.ok) {
    throw new IntegrationError(
      "cursor",
      `GET ${args.path} → ${res.status}: ${text.slice(0, 500)}`,
    );
  }
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    throw new IntegrationError("cursor", `GET ${args.path}: response is not JSON`);
  }

  if (useEtag && res.ok) {
    const etag = res.headers.get("etag");
    if (etag?.trim()) {
      cursorGetEtagCache.set(url, { etag: etag.trim(), body: data, storedAt: now });
    }
  }
  return data;
}

export async function cursorTeamPostJson<T = unknown>(args: {
  path: string;
  body: unknown;
  apiKey: string;
  fetchImpl?: Fetch;
}): Promise<T> {
  const f = args.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const url = buildCursorUrl(args.path);
  const res = await f(url, {
    method: "POST",
    headers: {
      Authorization: cursorTeamBasicAuthHeader(args.apiKey),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args.body ?? {}),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new IntegrationError(
      "cursor",
      `POST ${args.path} → ${res.status}: ${text.slice(0, 500)}`,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new IntegrationError("cursor", `POST ${args.path}: response is not JSON`);
  }
}
