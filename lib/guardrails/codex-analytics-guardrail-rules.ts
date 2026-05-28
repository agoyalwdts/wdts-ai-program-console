/**
 * Codex Enterprise Analytics guardrail rules (credits / clients — not per-request models).
 */

import type { ProductKey } from "./day-one-defaults";
import type { GuardrailCandidate } from "./types";

export const CODEX_CREDITS_WARN_PER_DAY = 10;
export const CODEX_CREDITS_HIGH_PER_DAY = 20;
export const CODEX_MULTI_CLIENT_MIN = 2;

export function pushCodexAnalyticsGuardrailCandidates(args: {
  candidates: GuardrailCandidate[];
  occurredAt: Date;
  environment: string;
  userEmail: string;
  model: string;
  credits: number;
  turns: number;
  clientIds: string[];
  costUsd: number | null;
  dedupe: (parts: readonly string[]) => string;
}): void {
  const product: ProductKey = "CODEX";
  const base = {
    occurredAt: args.occurredAt,
    environment: args.environment,
    product,
    userEmail: args.userEmail,
    model: args.model,
    source: "CODEX_ENTERPRISE_ANALYTICS" as const,
  };

  const day = args.occurredAt.toISOString().slice(0, 10);

  if (args.credits >= CODEX_CREDITS_HIGH_PER_DAY) {
    args.candidates.push({
      ...base,
      category: "COMPLEXITY_ADVISOR",
      severity: "HIGH",
      ruleCode: "CODEX_HIGH_DAILY_CREDITS",
      title: "Codex daily credit usage is high",
      rationale: `${args.credits.toFixed(1)} credits in one analytics bucket (≥ ${CODEX_CREDITS_HIGH_PER_DAY}). Review tier and task complexity.`,
      recommendation: "Confirm Codex sub-tier matches need; avoid premium posture for routine work.",
      context: {
        credits: args.credits,
        turns: args.turns,
        clientIds: args.clientIds,
        costUsd: args.costUsd,
      },
      dedupeKey: args.dedupe(["CODEX_HIGH_DAILY_CREDITS", args.userEmail, day]),
    });
  } else if (args.credits >= CODEX_CREDITS_WARN_PER_DAY) {
    args.candidates.push({
      ...base,
      category: "COMPLEXITY_ADVISOR",
      severity: "MEDIUM",
      ruleCode: "CODEX_ELEVATED_DAILY_CREDITS",
      title: "Codex daily credit usage elevated",
      rationale: `${args.credits.toFixed(1)} credits in one analytics bucket (≥ ${CODEX_CREDITS_WARN_PER_DAY}).`,
      recommendation: "Track whether usage aligns with assigned Codex sub-tier.",
      context: {
        credits: args.credits,
        turns: args.turns,
        clientIds: args.clientIds,
        costUsd: args.costUsd,
      },
      dedupeKey: args.dedupe(["CODEX_ELEVATED_DAILY_CREDITS", args.userEmail, day]),
    });
  }

  const activeClients = args.clientIds.filter(Boolean);
  if (activeClients.length >= CODEX_MULTI_CLIENT_MIN) {
    args.candidates.push({
      ...base,
      category: "MODEL_POSTURE",
      severity: "LOW",
      ruleCode: "CODEX_MULTI_CLIENT_SURFACE",
      title: "Codex used from multiple client surfaces same day",
      rationale: `${activeClients.length} distinct client_id values with usage: ${activeClients.join(", ")}.`,
      recommendation:
        "Multiple surfaces (CLI, IDE, web) can indicate environment sprawl — standardize on one approved client where possible.",
      context: {
        credits: args.credits,
        turns: args.turns,
        clientIds: activeClients,
      },
      dedupeKey: args.dedupe([
        "CODEX_MULTI_CLIENT_SURFACE",
        args.userEmail,
        day,
        activeClients.sort().join(","),
      ]),
    });
  }
}
