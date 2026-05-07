import { CODEX_TIERS } from "@/lib/program";
import type { CodexSeat, CodexSubTier } from "./types";

export type OrgMemberBrief = {
  id: string;
  email: string;
  displayName: string;
};

function normEmail(e: string): string {
  return e.trim().toLowerCase();
}

/**
 * One seat per OpenAI org member (`/v1/organization/users`). When the same
 * email has a Prisma CODEX `License`, that row wins for tier / cap / MTD
 * (MTD re-applied after merge in `enrichCodexSeatsFromUsageRecords`). Otherwise
 * emit a STANDARD placeholder so F9 "filled" tracks org roster, not only
 * licensed rows.
 */
export function mergeOrgUsersWithPrismaCodexSeats(args: {
  orgMembers: OrgMemberBrief[];
  prismaSeats: CodexSeat[];
  /** Dashboard `User.id` by normalised email — for MTD / idle when there is no CODEX license yet */
  dashboardUserIdByNormEmail: Map<string, string>;
}): CodexSeat[] {
  const { orgMembers, prismaSeats, dashboardUserIdByNormEmail } = args;
  const byEmail = new Map<string, CodexSeat>();
  for (const s of prismaSeats) {
    byEmail.set(normEmail(s.email), s);
  }

  const defaultTier: CodexSubTier = "STANDARD";
  const defaultCap = CODEX_TIERS.STANDARD.capUsdMonth;

  const out: CodexSeat[] = [];
  for (const m of orgMembers) {
    const key = normEmail(m.email);
    if (!key) continue;
    const lic = byEmail.get(key);
    if (lic) {
      byEmail.delete(key);
      out.push(lic);
    } else {
      const dashId = dashboardUserIdByNormEmail.get(key);
      const userId = dashId ?? `openai-org:${m.id}`;
      out.push({
        userId,
        email: m.email,
        displayName: m.displayName,
        subTier: defaultTier,
        capUsdMonth: defaultCap,
        mtdSpendUsd: 0,
        lastActivityTs: null,
        idleDays: null,
      });
    }
  }

  for (const s of byEmail.values()) {
    out.push(s);
  }

  return out;
}
