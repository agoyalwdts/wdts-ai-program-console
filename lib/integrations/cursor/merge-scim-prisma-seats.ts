import type { CursorSeat, CursorSubTier } from "./types";

export type ScimMemberBrief = {
  id: string;
  email: string;
  displayName: string;
  active: boolean;
};

function normEmail(e: string): string {
  return e.trim().toLowerCase();
}

/**
 * One seat per live workspace member. When the same email exists in Prisma
 * (program `License`), that row wins for tier / MTD / idle. Prisma-only
 * licenses are omitted unless `includePrismaOrphans` is true (synthetic dev).
 */
export function mergeScimMembersWithPrismaSeats(
  scimMembers: ScimMemberBrief[],
  prismaSeats: CursorSeat[],
  opts?: {
    includePrismaOrphans?: boolean;
    workspaceOnlyUserIdPrefix?: string;
  },
): CursorSeat[] {
  const includePrismaOrphans = opts?.includePrismaOrphans ?? true;
  const orphanPrefix = opts?.workspaceOnlyUserIdPrefix ?? "scim:";

  const byEmail = new Map<string, CursorSeat>();
  for (const s of prismaSeats) {
    byEmail.set(normEmail(s.email), s);
  }

  const out: CursorSeat[] = [];
  for (const m of scimMembers) {
    if (m.active === false) continue;
    const key = normEmail(m.email);
    const lic = byEmail.get(key);
    if (lic) {
      byEmail.delete(key);
      out.push(lic);
    } else {
      const defaultTier: CursorSubTier = "STANDARD";
      out.push({
        userId: `${orphanPrefix}${m.id}`,
        email: m.email,
        displayName: m.displayName,
        subTier: defaultTier,
        lastActivityTs: null,
        idleDays: null,
        mtdSpendUsd: 0,
      });
    }
  }

  if (includePrismaOrphans) {
    for (const s of byEmail.values()) {
      out.push(s);
    }
  }

  return out;
}
