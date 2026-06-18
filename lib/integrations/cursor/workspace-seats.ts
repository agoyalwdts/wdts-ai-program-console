/**
 * Load F4 workspace members — live Cursor APIs in real mode, Prisma licenses in synthetic.
 */

import type { Fetch } from "../_http";
import { getIntegrationMode } from "../env";
import {
  mergeScimMembersWithPrismaSeats,
  type ScimMemberBrief,
} from "./merge-scim-prisma-seats";
import { listCursorSeatsFromPrisma } from "./prisma-cursor-seats";
import { listScimUsers, readScimEnv } from "./scim-list-users";
import { listTeamAdminMembers } from "./team-admin-members";
import { syntheticCursorClient } from "./synthetic";
import type { CursorSeat } from "./types";

export type CursorWorkspaceSource =
  | "synthetic_prisma"
  | "team_admin"
  | "scim"
  | "team_admin_and_scim"
  | "unavailable";

export type CursorWorkspaceLoadResult = {
  seats: CursorSeat[];
  source: CursorWorkspaceSource;
  warnings: string[];
  waitlist: Awaited<ReturnType<typeof syntheticCursorClient.listWaitlist>>;
};

function normEmail(e: string): string {
  return e.trim().toLowerCase();
}

function dedupeMembers(members: ScimMemberBrief[]): ScimMemberBrief[] {
  const byEmail = new Map<string, ScimMemberBrief>();
  for (const m of members) {
    const key = normEmail(m.email);
    if (!key.includes("@")) continue;
    if (!byEmail.has(key)) byEmail.set(key, m);
  }
  return [...byEmail.values()];
}

async function loadLiveWorkspaceMembers(args?: {
  env?: Record<string, string | undefined>;
  fetchImpl?: Fetch;
}): Promise<{ members: ScimMemberBrief[]; source: CursorWorkspaceSource; warnings: string[] }> {
  const env = args?.env ?? process.env;
  const warnings: string[] = [];
  let teamAdmin: ScimMemberBrief[] = [];
  let scim: ScimMemberBrief[] = [];

  try {
    teamAdmin = await listTeamAdminMembers({ env, fetchImpl: args?.fetchImpl });
  } catch (err) {
    warnings.push(
      `Team Admin GET /teams/members failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const scimEnv = readScimEnv(env);
  if (scimEnv) {
    try {
      scim = await listScimUsers(scimEnv, args?.fetchImpl);
    } catch (err) {
      if (teamAdmin.length === 0) {
        warnings.push(
          `SCIM listUsers failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  const members = dedupeMembers([...teamAdmin, ...scim]);
  if (members.length === 0) {
    return { members: [], source: "unavailable", warnings };
  }

  if (teamAdmin.length > 0 && scim.length > 0) {
    return { members, source: "team_admin_and_scim", warnings };
  }
  if (teamAdmin.length > 0) {
    return { members, source: "team_admin", warnings };
  }
  return { members, source: "scim", warnings };
}

export async function loadCursorWorkspaceSeats(args?: {
  env?: Record<string, string | undefined>;
  fetchImpl?: Fetch;
}): Promise<CursorWorkspaceLoadResult> {
  const env = args?.env ?? process.env;
  const mode = getIntegrationMode("cursor", env);

  if (mode !== "real") {
    const [seats, waitlist] = await Promise.all([
      syntheticCursorClient.listSeats(),
      syntheticCursorClient.listWaitlist(),
    ]);
    return {
      seats,
      waitlist,
      source: "synthetic_prisma",
      warnings: ["INTEGRATION_CURSOR is not `real` — showing dev Prisma License rows."],
    };
  }

  const prismaSeats = await listCursorSeatsFromPrisma();
  const live = await loadLiveWorkspaceMembers({ env, fetchImpl: args?.fetchImpl });

  if (live.members.length === 0) {
    return {
      seats: [],
      waitlist: [],
      source: "unavailable",
      warnings: [
        ...live.warnings,
        "No live workspace members returned. Prisma seed licenses are not shown in real mode.",
      ],
    };
  }

  const seats = mergeScimMembersWithPrismaSeats(live.members, prismaSeats, {
    includePrismaOrphans: false,
    workspaceOnlyUserIdPrefix: "cursor:",
  });

  return {
    seats,
    waitlist: [],
    source: live.source,
    warnings: live.warnings,
  };
}
