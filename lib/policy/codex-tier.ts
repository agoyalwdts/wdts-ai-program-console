/**
 * Codex tier policy helpers — maps between dashboard tier enums, Prisma
 * `License.subTier` strings, and the policy-repo assignment delta format.
 *
 * Canonical policy repo path convention: per-decision delta files under
 * `assignments/codex/` (merged into `tiers/codex.yaml` on human review).
 * Refs: lib/integrations/policyrepo/real.test.ts (tiers/codex.yaml shape).
 */

import { CODEX_TIERS } from "@/lib/program";
import type { CodexSubTier } from "@/lib/integrations/openai";
import type { PolicyFile } from "@/lib/integrations/policyrepo/types";

/** Highest → lowest privilege (matches F9 ladder ordering). */
export const CODEX_TIER_ORDER: readonly CodexSubTier[] = [
  "POWER",
  "STANDARD",
  "LIGHT",
  "DISCOVERY",
];

export function codexSubTierToLicenseSubTier(tier: CodexSubTier): string {
  return `codex_${tier.toLowerCase()}`;
}

export function licenseSubTierToCodexSubTier(subTier: string): CodexSubTier | null {
  switch (subTier) {
    case "codex_power":
      return "POWER";
    case "codex_standard":
      return "STANDARD";
    case "codex_light":
      return "LIGHT";
    case "codex_discovery":
      return "DISCOVERY";
    default:
      return null;
  }
}

export function adjacentCodexTier(
  from: CodexSubTier,
  direction: "promote" | "demote",
): CodexSubTier | null {
  const idx = CODEX_TIER_ORDER.indexOf(from);
  if (idx < 0) return null;
  const next = direction === "promote" ? idx - 1 : idx + 1;
  if (next < 0 || next >= CODEX_TIER_ORDER.length) return null;
  return CODEX_TIER_ORDER[next]!;
}

export function codexTierMoveDecisionType(
  from: CodexSubTier,
  to: CodexSubTier,
): "TIER_PROMOTION" | "TIER_DEMOTION" {
  const fromIdx = CODEX_TIER_ORDER.indexOf(from);
  const toIdx = CODEX_TIER_ORDER.indexOf(to);
  return toIdx < fromIdx ? "TIER_PROMOTION" : "TIER_DEMOTION";
}

export function buildCodexTierAssignmentFile(args: {
  decisionId: string;
  email: string;
  fromSubTier: CodexSubTier;
  toSubTier: CodexSubTier;
  justification: string;
  actorEmail: string;
}): PolicyFile {
  const fromLicense = codexSubTierToLicenseSubTier(args.fromSubTier);
  const toLicense = codexSubTierToLicenseSubTier(args.toSubTier);
  const capUsdMonth = CODEX_TIERS[args.toSubTier].capUsdMonth;
  const escapedJustification = args.justification.replace(/\n/g, "\n  ");
  const content = [
    "# Codex tier assignment — opened by WDTS AI Program Console (F6).",
    `# Merge updates tiers/codex.yaml: ${args.email}: ${toLicense}`,
    `decision_id: ${args.decisionId}`,
    `subject_email: ${args.email}`,
    `from_sub_tier: ${fromLicense}`,
    `to_sub_tier: ${toLicense}`,
    `cap_usd_month: ${capUsdMonth}`,
    `actor_email: ${args.actorEmail}`,
    `requested_at: ${new Date().toISOString()}`,
    "justification: |",
    `  ${escapedJustification}`,
    "",
  ].join("\n");

  return {
    path: `assignments/codex/${args.decisionId}.yaml`,
    content,
  };
}
