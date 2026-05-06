/**
 * Shared Basic-auth JSON helpers for `https://api.cursor.com` (Team Admin,
 * Analytics, AI Code Tracking, Cloud Agents v1 — see https://cursor.com/docs/api).
 */

import { IntegrationError } from "../errors";
import type { Fetch } from "../_http";
import { CURSOR_TEAM_ADMIN_API_BASE } from "./team-admin-usage";

export function cursorTeamBasicAuthHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
}

export async function cursorTeamGetJson<T = unknown>(args: {
  path: string;
  query?: Record<string, string | number | undefined>;
  apiKey: string;
  fetchImpl?: Fetch;
}): Promise<T> {
  const f = args.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const u = new URL(args.path, CURSOR_TEAM_ADMIN_API_BASE);
  if (args.query) {
    for (const [k, v] of Object.entries(args.query)) {
      if (v === undefined || v === "") continue;
      u.searchParams.set(k, String(v));
    }
  }
  const res = await f(u.toString(), {
    method: "GET",
    headers: {
      Authorization: cursorTeamBasicAuthHeader(args.apiKey),
      Accept: "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new IntegrationError(
      "cursor",
      `GET ${args.path} → ${res.status}: ${text.slice(0, 500)}`,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new IntegrationError("cursor", `GET ${args.path}: response is not JSON`);
  }
}
