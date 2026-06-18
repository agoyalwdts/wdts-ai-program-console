/**
 * Synthetic CursorClient — derives workspace members from dev DB License rows
 * and synthesises a small waitlist for local UI testing.
 */

import { prisma } from "@/lib/prisma";
import { listCursorSeatsFromPrisma } from "./prisma-cursor-seats";
import type { CursorClient, CursorSubTier, CursorWaitlistEntry } from "./types";

export const syntheticCursorClient: CursorClient = {
  async listSeats() {
    return listCursorSeatsFromPrisma();
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
