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
 * One seat per active SCIM workspace member. When the same email exists in
 * Prisma (program `License`), that row wins for tier / MTD / idle; otherwise
 * emit a placeholder STANDARD seat so F4 "filled" matches workspace size.
 */
export function mergeScimMembersWithPrismaSeats(
  scimMembers: ScimMemberBrief[],
  prismaSeats: CursorSeat[],
): CursorSeat[] {
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
        userId: `scim:${m.id}`,
        email: m.email,
        displayName: m.displayName,
        subTier: defaultTier,
        lastActivityTs: null,
        idleDays: null,
        mtdSpendUsd: 0,
      });
    }
  }

  // Licensed users not returned by SCIM (e.g. SCIM outage or shadow rows).
  for (const s of byEmail.values()) {
    out.push(s);
  }

  return out;
}
