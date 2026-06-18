/**
 * Cursor Team Admin API — GET /teams/members (live workspace roster).
 * @see https://cursor.com/docs/account/teams/admin-api
 */

import type { Fetch } from "../_http";
import { cursorTeamGetJson } from "./cursor-team-http";
import type { ScimMemberBrief } from "./merge-scim-prisma-seats";
import { resolveCursorTeamAdminApiKey } from "./team-admin-usage";

type TeamAdminMemberRow = {
  id?: number;
  email?: string;
  name?: string;
  role?: string;
  isRemoved?: boolean;
};

type TeamMembersResponse = {
  teamMembers?: TeamAdminMemberRow[];
};

export async function listTeamAdminMembers(args?: {
  env?: Record<string, string | undefined>;
  fetchImpl?: Fetch;
}): Promise<ScimMemberBrief[]> {
  const env = args?.env ?? process.env;
  const apiKey = resolveCursorTeamAdminApiKey(env);
  if (!apiKey) return [];

  const data = await cursorTeamGetJson<TeamMembersResponse>({
    path: "/teams/members",
    apiKey,
    fetchImpl: args?.fetchImpl,
  });

  const rows = Array.isArray(data.teamMembers) ? data.teamMembers : [];
  return rows
    .filter((m) => m.isRemoved !== true && typeof m.email === "string" && m.email.includes("@"))
    .map((m) => ({
      id: `admin-${m.id ?? m.email}`,
      email: m.email!.trim(),
      displayName: (m.name?.trim() || m.email)!.trim(),
      active: true,
    }));
}
