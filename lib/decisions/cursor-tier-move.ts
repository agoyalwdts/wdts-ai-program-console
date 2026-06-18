import type { PrismaClient } from "@prisma/client";
import type { CursorSubTier } from "@/lib/integrations/cursor/types";
import { getPolicyRepoClient } from "@/lib/integrations";
import type { PolicyRepoClient } from "@/lib/integrations/policyrepo/types";
import {
  adjacentCursorTier,
  buildCursorTierAssignmentFile,
  cursorSubTierToLicenseSubTier,
  cursorTierMoveDecisionType,
  licenseSubTierToCursorSubTier,
} from "@/lib/policy/cursor-tier";
import { CURSOR_TIERS } from "@/lib/program";

export type CursorTierMoveResult =
  | {
      ok: true;
      decisionId: string;
      decisionType: "TIER_PROMOTION" | "TIER_DEMOTION";
      fromSubTier: CursorSubTier;
      toSubTier: CursorSubTier;
      prUrl: string;
      prNumber: number;
    }
  | { ok: false; status: number; error: string; decisionId?: string };

export async function requestCursorTierMove(args: {
  prisma: PrismaClient;
  actorEmail: string;
  userId: string;
  direction: "promote" | "demote";
  toSubTier?: CursorSubTier;
  justification: string;
  policyRepo?: PolicyRepoClient;
}): Promise<CursorTierMoveResult> {
  const justification = args.justification.trim();
  if (justification.length < 10) {
    return {
      ok: false,
      status: 400,
      error: "Justification must be at least 10 characters.",
    };
  }

  const license = await args.prisma.license.findUnique({
    where: { userId_product: { userId: args.userId, product: "CURSOR" } },
    include: { user: true },
  });
  if (!license) {
    return { ok: false, status: 404, error: "User has no Cursor license row." };
  }

  const fromSubTier = licenseSubTierToCursorSubTier(license.subTier);
  if (!fromSubTier) {
    return {
      ok: false,
      status: 409,
      error: `Unknown Cursor subTier on license: ${license.subTier}`,
    };
  }

  const toSubTier =
    args.toSubTier ?? adjacentCursorTier(fromSubTier, args.direction);
  if (!toSubTier) {
    return {
      ok: false,
      status: 409,
      error:
        args.direction === "promote"
          ? "User is already at the highest Cursor tier (Power)."
          : "User is already at the lowest Cursor tier (Discovery).",
    };
  }

  if (toSubTier === fromSubTier) {
    return { ok: false, status: 409, error: "Target tier matches current tier." };
  }

  const expectedAdjacent = adjacentCursorTier(fromSubTier, args.direction);
  if (expectedAdjacent !== toSubTier) {
    return {
      ok: false,
      status: 400,
      error: `Invalid tier transition: ${fromSubTier} → ${toSubTier}. Only one-step ${args.direction} moves are supported.`,
    };
  }

  const decisionType = cursorTierMoveDecisionType(fromSubTier, toSubTier);
  const policyRepo = args.policyRepo ?? getPolicyRepoClient();

  const decision = await args.prisma.decision.create({
    data: {
      type: decisionType,
      subjectUserId: args.userId,
      beforeState: JSON.stringify({
        cursor_tier: fromSubTier,
        license_sub_tier: license.subTier,
        cap_usd_month: license.capUsdMonth ?? CURSOR_TIERS[fromSubTier].capUsdMonth,
      }),
      afterState: JSON.stringify({
        cursor_tier: toSubTier,
        license_sub_tier: cursorSubTierToLicenseSubTier(toSubTier),
        cap_usd_month: CURSOR_TIERS[toSubTier].capUsdMonth,
      }),
      actorEmail: args.actorEmail,
      justification,
    },
  });

  const policyFile = buildCursorTierAssignmentFile({
    decisionId: decision.id,
    email: license.user.email,
    fromSubTier,
    toSubTier,
    justification,
    actorEmail: args.actorEmail,
  });

  const title = `Cursor ${decisionType === "TIER_PROMOTION" ? "promotion" : "demotion"}: ${fromSubTier} → ${toSubTier} (${license.user.email})`;
  const body = [
    `**Subject:** ${license.user.displayName} (${license.user.email})`,
    `**Change:** ${fromSubTier} → ${toSubTier}`,
    "",
    justification,
  ].join("\n");

  try {
    const pr = await policyRepo.openPullRequest({
      decisionId: decision.id,
      authorEmail: args.actorEmail,
      title,
      body,
      files: [policyFile],
    });

    await args.prisma.decision.update({
      where: { id: decision.id },
      data: { evidenceLink: pr.url },
    });

    return {
      ok: true,
      decisionId: decision.id,
      decisionType,
      fromSubTier,
      toSubTier,
      prUrl: pr.url,
      prNumber: pr.number,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 502,
      error: `Policy repo PR failed: ${message}`,
      decisionId: decision.id,
    };
  }
}
