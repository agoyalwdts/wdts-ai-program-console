/**
 * Synthetic CursorClient — derives the 120-seat board from the dev DB
 * (License rows where product='CURSOR') and synthesises a small waitlist.
 * Four sub-tiers per §4.6.1 (v2.0+ shape, current at v2.3): Power /
 * Standard / Light / Discovery.
 *
 * The waitlist isn't represented in the v0.1 schema; the v0.2 schema will
 * add a CursorWaitlistEntry model. Until then, we synthesise a small
 * deterministic list so F4 has something to render.
 */

import { prisma } from "@/lib/prisma";
import type { CursorClient, CursorSeat, CursorSubTier, CursorWaitlistEntry } from "./types";

function asSubTier(s: string): CursorSubTier {
  switch (s) {
    case "cursor_power":
      return "POWER";
    case "cursor_standard":
      return "STANDARD";
    case "cursor_light":
      return "LIGHT";
    case "cursor_discovery":
      return "DISCOVERY";
    default:
      throw new Error(`Unknown Cursor sub-tier from DB: ${s}`);
  }
}

export const syntheticCursorClient: CursorClient = {
  async listSeats(): Promise<CursorSeat[]> {
    const licenses = await prisma.license.findMany({
      where: { product: "CURSOR" },
      include: {
        user: {
          include: {
            usageRecords: {
              where: { product: "CURSOR", decision: "ALLOWED" },
              orderBy: { ts: "desc" },
              take: 1,
            },
          },
        },
      },
    });

    const userIds = licenses.map((l) => l.userId);
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const mtd = await prisma.usageRecord.groupBy({
      by: ["userId"],
      where: {
        userId: { in: userIds },
        product: "CURSOR",
        ts: { gte: monthStart, lte: now },
      },
      _sum: { costUsd: true },
    });
    const mtdByUser = new Map(mtd.map((a) => [a.userId, a._sum.costUsd ?? 0]));

    return licenses.map<CursorSeat>((l) => {
      const lastTs = l.user.usageRecords[0]?.ts ?? null;
      const idleDays = lastTs
        ? Math.floor((now.getTime() - lastTs.getTime()) / (24 * 60 * 60 * 1000))
        : null;
      return {
        userId: l.userId,
        email: l.user.email,
        displayName: l.user.displayName,
        subTier: asSubTier(l.subTier),
        lastActivityTs: lastTs,
        idleDays,
        mtdSpendUsd: mtdByUser.get(l.userId) ?? 0,
      };
    });
  },

  async listWaitlist(): Promise<CursorWaitlistEntry[]> {
    // Drawn from §4.6.4 priority order: bottom-36 trial users with attestation
    // + loaner usage, new joiners with manager attestation, then Steering
    // exceptions. Deterministic — exposed as a stub until the v0.2 schema adds
    // a real CursorWaitlistEntry model.
    const seatHolders = await prisma.license.findMany({
      where: { product: "CURSOR" },
      select: { userId: true },
    });
    const seatHolderIds = new Set(seatHolders.map((s) => s.userId));
    const candidates = await prisma.user.findMany({
      where: { id: { notIn: [...seatHolderIds] } },
      select: { displayName: true, email: true, roleTag: true },
      orderBy: { displayName: "asc" },
      take: 8,
    });

    const RATIONALES = [
      "Auto-promotion: 2 consecutive months >50% Codex Standard cap utilisation",
      "Manager attestation: dedicated agent-mode workload starting next quarter",
      "Backfill following hugo.liu reclamation",
      "New hire — onboarding cohort 2026-Q2",
      "Demoted from trial seat; re-applying with attestation",
      "Documentation team lead — mixed Cursor + Claude.ai workflow",
      "Contractor renewal — needs Cursor for new gaming-systems project",
      "Steering exception request pending",
    ];
    const REASONS: CursorWaitlistEntry["reason"][] = [
      "LOANER_USAGE",
      "LOANER_USAGE",
      "LOANER_USAGE",
      "NEW_JOINER",
      "LOANER_USAGE",
      "NEW_JOINER",
      "NEW_JOINER",
      "STEERING_EXCEPTION",
    ];
    // requestedTier distribution mirrors the §4.6.1 sub-tier shape (most
    // waitlist requests are for Standard/Light; a couple are Discovery
    // promotions, only one or two are Power-tier asks).
    const requestedTier = (i: number): CursorSubTier => {
      if (i < 1) return "POWER";
      if (i < 4) return "STANDARD";
      if (i < 6) return "LIGHT";
      return "DISCOVERY";
    };
    return candidates.map<CursorWaitlistEntry>((c, i) => ({
      email: c.email,
      displayName: c.displayName,
      roleTag: c.roleTag,
      reason: REASONS[i] ?? "NEW_JOINER",
      requestedTier: requestedTier(i),
      rationale: RATIONALES[i] ?? "",
      position: i + 1,
    }));
  },
};
