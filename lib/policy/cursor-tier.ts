/**
 * Cursor tier policy helpers — maps between dashboard tier enums, Prisma
 * `License.subTier` strings, and policy-repo assignment deltas.
 */

import { CURSOR_TIERS } from "@/lib/program";
import type { CursorSubTier } from "@/lib/integrations/cursor/types";
import type { PolicyFile } from "@/lib/integrations/policyrepo/types";

export const CURSOR_TIER_ORDER: readonly CursorSubTier[] = [
  "POWER",
  "STANDARD",
  "LIGHT",
  "DISCOVERY",
];

export function cursorSubTierToLicenseSubTier(tier: CursorSubTier): string {
  return `cursor_${tier.toLowerCase()}`;
}

export function licenseSubTierToCursorSubTier(subTier: string): CursorSubTier | null {
  switch (subTier) {
    case "cursor_power":
      return "POWER";
    case "cursor_standard":
      return "STANDARD";
    case "cursor_light":
      return "LIGHT";
    case "cursor_discovery":
      return "DISCOVERY";
    default:
      return null;
  }
}

export function adjacentCursorTier(
  from: CursorSubTier,
  direction: "promote" | "demote",
): CursorSubTier | null {
  const idx = CURSOR_TIER_ORDER.indexOf(from);
  if (idx < 0) return null;
  const next = direction === "promote" ? idx - 1 : idx + 1;
  if (next < 0 || next >= CURSOR_TIER_ORDER.length) return null;
  return CURSOR_TIER_ORDER[next]!;
}

export function cursorTierMoveDecisionType(
  from: CursorSubTier,
  to: CursorSubTier,
): "TIER_PROMOTION" | "TIER_DEMOTION" {
  const fromIdx = CURSOR_TIER_ORDER.indexOf(from);
  const toIdx = CURSOR_TIER_ORDER.indexOf(to);
  return toIdx < fromIdx ? "TIER_PROMOTION" : "TIER_DEMOTION";
}

export function buildCursorTierAssignmentFile(args: {
  decisionId: string;
  email: string;
  fromSubTier: CursorSubTier;
  toSubTier: CursorSubTier;
  justification: string;
  actorEmail: string;
}): PolicyFile {
  const fromLicense = cursorSubTierToLicenseSubTier(args.fromSubTier);
  const toLicense = cursorSubTierToLicenseSubTier(args.toSubTier);
  const capUsdMonth = CURSOR_TIERS[args.toSubTier].capUsdMonth;
  const escapedJustification = args.justification.replace(/\n/g, "\n  ");
  const content = [
    "# Cursor tier assignment — opened by WDTS AI Program Console (F6).",
    `# Merge updates tiers/cursor.yaml: ${args.email}: ${toLicense}`,
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
    path: `assignments/cursor/${args.decisionId}.yaml`,
    content,
  };
}

export function buildCursorReclamationFile(args: {
  decisionId: string;
  email: string;
  licenseSubTier: string;
  justification: string;
  actorEmail: string;
  reclamationEventId: string;
}): PolicyFile {
  const escapedJustification = args.justification.replace(/\n/g, "\n  ");
  const content = [
    "# Cursor seat reclamation — opened by WDTS AI Program Console (F7).",
    `# Remove ${args.email} from tiers/cursor.yaml on merge.`,
    `decision_id: ${args.decisionId}`,
    `reclamation_event_id: ${args.reclamationEventId}`,
    `subject_email: ${args.email}`,
    `product: CURSOR`,
    `action: reclaim`,
    `license_sub_tier: ${args.licenseSubTier}`,
    `actor_email: ${args.actorEmail}`,
    `requested_at: ${new Date().toISOString()}`,
    "justification: |",
    `  ${escapedJustification}`,
    "",
  ].join("\n");

  return {
    path: `assignments/cursor/reclaims/${args.decisionId}.yaml`,
    content,
  };
}
