/**
 * ChatGPT Enterprise SCIM 2.0 — list workspace members (GET /Users).
 * Canonical roster for ChatGPT/Codex seats; org Admin API often under-counts.
 *
 * Env: OPENAI_SCIM_API_TOKEN (required), OPENAI_SCIM_BASE_URL (required in prod —
 * copy the full Endpoint from ChatGPT admin → Directory Sync Setup → Configure
 * Directory Provider, e.g. https://external.auth.openai.com/scim/v2.0/<workspace-id>).
 * Do not use the generic api.openai.com default unless your admin page shows that URL.
 */

import { jsonGet, type Fetch } from "../_http";
import { isConfiguredScimBaseUrl } from "../cursor/scim-list-users";
import type { OrgMemberBrief } from "./merge-org-prisma-codex-seats";

const DEFAULT_SCIM_BASE = "https://api.openai.com/scim/v2";

type ScimUser = {
  id: string;
  userName: string;
  displayName?: string;
  active: boolean;
  emails?: Array<{ value: string; primary?: boolean }>;
  name?: { givenName?: string; familyName?: string };
};

type ScimListResponse = {
  totalResults: number;
  itemsPerPage: number;
  startIndex: number;
  Resources: ScimUser[];
};

export function readOpenAiScimEnv(
  env: Record<string, string | undefined> = process.env,
): { baseUrl: string; token: string } | null {
  const token = env.OPENAI_SCIM_API_TOKEN?.trim();
  if (!token || /^PLACEHOLDER/i.test(token)) return null;
  const rawBase = env.OPENAI_SCIM_BASE_URL?.trim() || DEFAULT_SCIM_BASE;
  if (!isConfiguredScimBaseUrl(rawBase)) return null;
  return { baseUrl: rawBase.replace(/\/$/, ""), token };
}

function primaryEmail(u: ScimUser): string {
  if (u.emails && u.emails.length > 0) {
    const primary = u.emails.find((e) => e.primary) ?? u.emails[0];
    return primary.value;
  }
  return u.userName;
}

function displayNameOf(u: ScimUser): string {
  if (u.displayName?.trim()) return u.displayName.trim();
  if (u.name) {
    const composed = `${u.name.givenName ?? ""} ${u.name.familyName ?? ""}`.trim();
    if (composed) return composed;
  }
  return primaryEmail(u);
}

export async function listOpenAiScimMembers(args?: {
  env?: Record<string, string | undefined>;
  fetchImpl?: Fetch;
}): Promise<OrgMemberBrief[]> {
  const scimEnv = readOpenAiScimEnv(args?.env);
  if (!scimEnv) return [];

  const out: ScimUser[] = [];
  let startIndex = 1;
  const count = 100;
  for (let i = 0; i < 50; i++) {
    const url = `${scimEnv.baseUrl}/Users?startIndex=${startIndex}&count=${count}`;
    const page = await jsonGet<ScimListResponse>(url, {
      integration: "openai",
      fetchImpl: args?.fetchImpl,
      headers: {
        Authorization: `Bearer ${scimEnv.token}`,
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
    }))
    .filter((m) => m.email.includes("@"));
}
