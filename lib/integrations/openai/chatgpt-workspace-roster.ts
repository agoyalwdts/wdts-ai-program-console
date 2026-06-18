/**
 * ChatGPT Enterprise workspace roster — SCIM + vendor export snapshots.
 * Supplements OpenAI Admin `/organization/users`, which often lists fewer
 * members than licensed ChatGPT/Codex workspace seats.
 */

import type { PrismaClient } from "@prisma/client";
import type { Fetch } from "../_http";
import type { OrgMemberBrief } from "./merge-org-prisma-codex-seats";
import { listOpenAiScimMembers, readOpenAiScimEnv } from "./scim-list-users";

function normEmail(e: string): string {
  return e.trim().toLowerCase();
}

function dedupeMembers(members: OrgMemberBrief[]): OrgMemberBrief[] {
  const byEmail = new Map<string, OrgMemberBrief>();
  for (const m of members) {
    const key = normEmail(m.email);
    if (!key.includes("@")) continue;
    if (!byEmail.has(key)) byEmail.set(key, m);
  }
  return [...byEmail.values()];
}

type SnapshotUserRow = {
  email?: string;
  name?: string;
  user_id?: string;
};

function membersFromUsersArray(
  users: SnapshotUserRow[] | undefined,
  idPrefix: string,
): OrgMemberBrief[] {
  if (!users?.length) return [];
  const out: OrgMemberBrief[] = [];
  for (const u of users) {
    const email = u.email?.trim();
    if (!email?.includes("@")) continue;
    const id = u.user_id?.trim() || `${idPrefix}${normEmail(email)}`;
    out.push({
      id,
      email,
      displayName: (u.name?.trim() || email).trim(),
    });
  }
  return out;
}

async function membersFromLatestChatGptUsersCsvSnapshot(
  prisma: PrismaClient,
): Promise<OrgMemberBrief[]> {
  const snap = await prisma.programVendorExportSnapshot.findFirst({
    where: { kind: "CHATGPT_USERS_CSV" },
    orderBy: { createdAt: "desc" },
    select: { payload: true, filename: true },
  });
  if (!snap?.payload || typeof snap.payload !== "object") return [];
  const users = (snap.payload as { users?: SnapshotUserRow[] }).users;
  return membersFromUsersArray(users, "chatgpt-csv:");
}

async function membersFromChatGptUserAnalyticsSnapshots(
  prisma: PrismaClient,
): Promise<OrgMemberBrief[]> {
  const snaps = await prisma.programVendorExportSnapshot.findMany({
    where: { kind: "CHATGPT_USER_ANALYTICS" },
    orderBy: { createdAt: "desc" },
    take: 45,
    select: { payload: true },
  });
  const merged: OrgMemberBrief[] = [];
  for (const snap of snaps) {
    if (!snap.payload || typeof snap.payload !== "object") continue;
    const users = (snap.payload as { users?: SnapshotUserRow[] }).users;
    merged.push(...membersFromUsersArray(users, "chatgpt-analytics:"));
  }
  return merged;
}

export type ChatGptWorkspaceRosterLoad = {
  members: OrgMemberBrief[];
  scimCount: number;
  csvSnapshotCount: number;
  analyticsSnapshotCount: number;
  warnings: string[];
};

export async function loadChatGptWorkspaceRosterMembers(args: {
  prisma: PrismaClient;
  env?: Record<string, string | undefined>;
  fetchImpl?: Fetch;
}): Promise<ChatGptWorkspaceRosterLoad> {
  const env = args.env ?? process.env;
  const warnings: string[] = [];
  let scimMembers: OrgMemberBrief[] = [];

  if (readOpenAiScimEnv(env)) {
    try {
      scimMembers = await listOpenAiScimMembers({ env, fetchImpl: args.fetchImpl });
    } catch (err) {
      warnings.push(
        `ChatGPT SCIM listUsers failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const [csvMembers, analyticsMembers] = await Promise.all([
    membersFromLatestChatGptUsersCsvSnapshot(args.prisma),
    membersFromChatGptUserAnalyticsSnapshots(args.prisma),
  ]);

  if (scimMembers.length === 0 && csvMembers.length === 0 && analyticsMembers.length === 0) {
    if (!readOpenAiScimEnv(env)) {
      warnings.push(
        "ChatGPT workspace roster: set OPENAI_SCIM_API_TOKEN for SCIM GET /Users, or import ChatGPT Business users CSV.",
      );
    }
  }

  const members = dedupeMembers([...scimMembers, ...csvMembers, ...analyticsMembers]);

  return {
    members,
    scimCount: scimMembers.length,
    csvSnapshotCount: csvMembers.length,
    analyticsSnapshotCount: analyticsMembers.length,
    warnings,
  };
}
