/**
 * Cursor SCIM 2.0 — list workspace members (GET /Users with pagination).
 * Used by the real CursorClient when CURSOR_SCIM_BASE_URL + token are set.
 */

import { jsonGet, type Fetch } from "../_http";
import type { ScimMemberBrief } from "./merge-scim-prisma-seats";

export function readScimEnv(
  env: Record<string, string | undefined> = process.env,
): { baseUrl: string; token: string } | null {
  const baseUrl = env.CURSOR_SCIM_BASE_URL?.trim();
  const token =
    env.CURSOR_ADMIN_TOKEN?.trim() || env.CURSOR_TEAM_ADMIN_API_KEY?.trim();
  if (!baseUrl || !token) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ""), token };
}

type ScimUser = {
  id: string;
  userName: string;
  displayName?: string;
  active: boolean;
  emails?: Array<{ value: string; primary?: boolean }>;
  name?: { givenName?: string; familyName?: string };
};

type ScimListResponse = {
  schemas: string[];
  totalResults: number;
  itemsPerPage: number;
  startIndex: number;
  Resources: ScimUser[];
};

function primaryEmail(u: ScimUser): string {
  if (u.emails && u.emails.length > 0) {
    const primary = u.emails.find((e) => e.primary) ?? u.emails[0];
    return primary.value;
  }
  return u.userName;
}

function displayNameOf(u: ScimUser): string {
  if (u.displayName) return u.displayName;
  if (u.name) {
    const composed = `${u.name.givenName ?? ""} ${u.name.familyName ?? ""}`.trim();
    if (composed) return composed;
  }
  return primaryEmail(u);
}

export async function listScimUsers(
  env: { baseUrl: string; token: string },
  fetchImpl?: Fetch,
): Promise<ScimMemberBrief[]> {
  const out: ScimUser[] = [];
  let startIndex = 1;
  const count = 100;
  for (let i = 0; i < 50; i++) {
    const url = `${env.baseUrl}/Users?startIndex=${startIndex}&count=${count}`;
    const page = await jsonGet<ScimListResponse>(url, {
      integration: "cursor",
      fetchImpl,
      headers: {
        Authorization: `Bearer ${env.token}`,
        Accept: "application/scim+json",
      },
    });
    const resources = Array.isArray(page.Resources) ? page.Resources : [];
    out.push(...resources);
    const total = typeof page.totalResults === "number" ? page.totalResults : out.length;
    if (resources.length < count) break;
    startIndex += count;
    if (out.length >= total) break;
  }

  return out
    .filter((u) => u.active !== false)
    .map((u) => ({
      id: u.id,
      email: primaryEmail(u),
      displayName: displayNameOf(u),
      active: u.active !== false,
    }));
}
