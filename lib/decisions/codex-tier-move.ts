import type { PrismaClient } from "@prisma/client";
import type { CodexSubTier } from "@/lib/integrations/openai";
import { getPolicyRepoClient } from "@/lib/integrations";
import type { PolicyRepoClient } from "@/lib/integrations/policyrepo/types";
import {
  adjacentCodexTier,
  buildCodexTierAssignmentFile,
  codexSubTierToLicenseSubTier,
  codexTierMoveDecisionType,
  licenseSubTierToCodexSubTier,
} from "@/lib/policy/codex-tier";
import { CODEX_TIERS } from "@/lib/program";

export type CodexTierMoveResult =
  | {
      ok: true;
      decisionId: string;
      decisionType: "TIER_PROMOTION" | "TIER_DEMOTION";
      fromSubTier: CodexSubTier;
      toSubTier: CodexSubTier;
      prUrl: string;
      prNumber: number;
    }
  | { ok: false; status: number; error: string; decisionId?: string };

export async function requestCodexTierMove(args: {
  prisma: PrismaClient;
  actorEmail: string;
  userId: string;
  direction: "promote" | "demote";
  toSubTier?: CodexSubTier;
  justification: string;
  policyRepo?: PolicyRepoClient;
}): Promise<CodexTierMoveResult> {
  const justification = args.justification.trim();
  if (justification.length < 10) {
    return {
      ok: false,
      status: 400,
      error: "Justification must be at least 10 characters.",
    };
  }

  const license = await args.prisma.license.findUnique({
    where: { userId_product: { userId: args.userId, product: "CODEX" } },
    include: { user: true },
  });
  if (!license) {
    return { ok: false, status: 404, error: "User has no Codex license row." };
  }

  const fromSubTier = licenseSubTierToCodexSubTier(license.subTier);
  if (!fromSubTier) {
    return {
      ok: false,
      status: 409,
      error: `Unknown Codex subTier on license: ${license.subTier}`,
    };
  }

  const toSubTier =
    args.toSubTier ?? adjacentCodexTier(fromSubTier, args.direction);
  if (!toSubTier) {
    return {
      ok: false,
      status: 409,
      error:
        args.direction === "promote"
          ? "User is already at the highest Codex tier (Power)."
          : "User is already at the lowest Codex tier (Discovery).",
    };
  }

  if (toSubTier === fromSubTier) {
    return { ok: false, status: 409, error: "Target tier matches current tier." };
  }

  const expectedAdjacent = adjacentCodexTier(fromSubTier, args.direction);
  if (expectedAdjacent !== toSubTier) {
    return {
      ok: false,
      status: 400,
      error: `Invalid tier transition: ${fromSubTier} → ${toSubTier}. Only one-step ${args.direction} moves are supported.`,
    };
  }

  const decisionType = codexTierMoveDecisionType(fromSubTier, toSubTier);
  const policyRepo = args.policyRepo ?? getPolicyRepoClient();

  const decision = await args.prisma.decision.create({
    data: {
      type: decisionType,
      subjectUserId: args.userId,
      beforeState: JSON.stringify({
        codex_tier: fromSubTier,
        license_sub_tier: license.subTier,
        cap_usd_month: license.capUsdMonth ?? CODEX_TIERS[fromSubTier].capUsdMonth,
      }),
      afterState: JSON.stringify({
        codex_tier: toSubTier,
        license_sub_tier: codexSubTierToLicenseSubTier(toSubTier),
        cap_usd_month: CODEX_TIERS[toSubTier].capUsdMonth,
      }),
      actorEmail: args.actorEmail,
      justification,
    },
  });

  const policyFile = buildCodexTierAssignmentFile({
    decisionId: decision.id,
    email: license.user.email,
    fromSubTier,
    toSubTier,
    justification,
    actorEmail: args.actorEmail,
  });

  const title = `Codex ${decisionType === "TIER_PROMOTION" ? "promotion" : "demotion"}: ${fromSubTier} → ${toSubTier} (${license.user.email})`;
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
