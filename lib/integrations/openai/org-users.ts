/**
 * OpenAI Admin API — list organisation members for F9 roster union.
 */

import { paginate, type Fetch } from "../_http";
import { IntegrationError } from "../errors";
import type { OrgMemberBrief } from "./merge-org-prisma-codex-seats";

const API_BASE = "https://api.openai.com/v1";

type Env = {
  apiKey: string;
  orgId: string;
};

export function readOpenAiAdminEnv(
  env: Record<string, string | undefined> = process.env,
): Env {
  const apiKey = env.OPENAI_ADMIN_API_KEY;
  const orgId = env.OPENAI_ORG_ID;
  if (!apiKey || !orgId) {
    throw new IntegrationError(
      "openai",
      "OPENAI_ADMIN_API_KEY and OPENAI_ORG_ID must be set when INTEGRATION_OPENAI=real.",
    );
  }
  return { apiKey, orgId };
}

function authHeaders(env: Env): Record<string, string> {
  return {
    Authorization: `Bearer ${env.apiKey}`,
    "OpenAI-Organization": env.orgId,
  };
}

type OrgUser = {
  object: "organization.user";
  id: string;
  email: string;
  name: string | null;
  role: "owner" | "reader";
  added_at?: number;
};

type OrgUsersPage = {
  object: "list";
  data: OrgUser[];
  first_id?: string;
  last_id?: string;
  has_more: boolean;
};

export async function listOpenAiOrgMembers(args?: {
  env?: Record<string, string | undefined>;
  fetchImpl?: Fetch;
}): Promise<OrgMemberBrief[]> {
  const env = readOpenAiAdminEnv(args?.env);
  const users = await paginate<OrgUsersPage, OrgUser>({
    integration: "openai",
    fetchImpl: args?.fetchImpl,
    initialUrl: `${API_BASE}/organization/users?limit=100`,
    headers: authHeaders(env),
    extractItems: (p) => p.data,
    nextUrl: (p, url) => {
      if (!p.has_more || !p.last_id) return null;
      const u = new URL(url);
      u.searchParams.set("after", p.last_id);
      return u.toString();
    },
  });
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    displayName: (u.name && u.name.trim()) || u.email,
  }));
}
