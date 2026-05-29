/**
 * Codex Enterprise Analytics guardrail rules (credits / clients — not per-request models).
 */

import { GUARDRAIL_CATEGORY } from "./categories";
import type { ProductKey } from "./day-one-defaults";
import type { GuardrailCandidate } from "./types";

export const CODEX_CREDITS_WARN_PER_DAY = 10;
export const CODEX_CREDITS_HIGH_PER_DAY = 20;
export const CODEX_MULTI_CLIENT_MIN = 2;

export function pushCodexAnalyticsGuardrailCandidates(args: {
  candidates: GuardrailCandidate[];
  occurredAt: Date;
  environment: string;
  userEmail: string | null;
  /** When email is missing, dedupe per analytics user_id instead of one shared "unknown". */
  codexUserId?: string | null;
  model: string;
  credits: number;
  turns: number;
  clientIds: string[];
  costUsd: number | null;
  dedupe: (parts: readonly string[]) => string;
}): void {
  const product: ProductKey = "CODEX";
  const subjectKey = args.userEmail ?? args.codexUserId?.trim() ?? "unknown";
  const base = {
    occurredAt: args.occurredAt,
    environment: args.environment,
    product,
    userEmail: args.userEmail,
    model: args.model,
    source: "CODEX_ENTERPRISE_ANALYTICS" as const,
  };

  const day = args.occurredAt.toISOString().slice(0, 10);
  const analyticsContext = {
    codexUserId: args.codexUserId?.trim() || null,
    credits: args.credits,
    turns: args.turns,
    clientIds: args.clientIds,
    costUsd: args.costUsd,
  };

  if (args.credits >= CODEX_CREDITS_HIGH_PER_DAY) {
    args.candidates.push({
      ...base,
      category: GUARDRAIL_CATEGORY.USAGE_POSTURE,
      severity: "HIGH",
      ruleCode: "CODEX_HIGH_DAILY_CREDITS",
      title: "Codex daily credit usage is high",
      rationale: `${args.credits.toFixed(1)} credits in one analytics bucket (≥ ${CODEX_CREDITS_HIGH_PER_DAY}). Review assigned Codex sub-tier and whether usage matches role.`,
      recommendation: "Confirm Codex sub-tier matches need; escalate if usage is routine work at premium credit burn.",
      context: analyticsContext,
      dedupeKey: args.dedupe(["CODEX_HIGH_DAILY_CREDITS", subjectKey, day]),
    });
  } else if (args.credits >= CODEX_CREDITS_WARN_PER_DAY) {
    args.candidates.push({
      ...base,
      category: GUARDRAIL_CATEGORY.USAGE_POSTURE,
      severity: "MEDIUM",
      ruleCode: "CODEX_ELEVATED_DAILY_CREDITS",
      title: "Codex daily credit usage elevated",
      rationale: `${args.credits.toFixed(1)} credits in one analytics bucket (≥ ${CODEX_CREDITS_WARN_PER_DAY}).`,
      recommendation: "Track whether usage aligns with assigned Codex sub-tier.",
      context: analyticsContext,
      dedupeKey: args.dedupe(["CODEX_ELEVATED_DAILY_CREDITS", subjectKey, day]),
    });
  }

  const activeClients = args.clientIds.filter(Boolean);
  if (activeClients.length >= CODEX_MULTI_CLIENT_MIN) {
    args.candidates.push({
      ...base,
      category: GUARDRAIL_CATEGORY.USAGE_POSTURE,
      severity: "LOW",
      ruleCode: "CODEX_MULTI_CLIENT_SURFACE",
      title: "Codex used from multiple client surfaces same day",
      rationale: `${activeClients.length} distinct client_id values with usage: ${activeClients.join(", ")}.`,
      recommendation:
        "Multiple surfaces (CLI, IDE, web) can indicate environment sprawl — standardize on one approved client where possible.",
      context: {
        ...analyticsContext,
        clientIds: activeClients,
      },
      dedupeKey: args.dedupe([
        "CODEX_MULTI_CLIENT_SURFACE",
        subjectKey,
        day,
        activeClients.sort().join(","),
      ]),
    });
  }
}
