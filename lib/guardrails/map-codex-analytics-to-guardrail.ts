/**
 * Map Codex Enterprise Analytics per-user usage buckets into guardrail monitor rows.
 * Analytics has no per-request model string — we infer posture from credits/turns/clients.
 */

import { Product } from "@prisma/client";
import type { CodexUsageRow } from "@/lib/integrations/codex-enterprise-analytics/types";
import { resolveCodexUsageRowEmail } from "@/lib/integrations/codex-enterprise-analytics/aggregate-per-user-mtd";
import { DAY_ONE_DEFAULT_MODEL } from "./day-one-defaults";
import type { GuardrailMonitorUsageRow } from "./load-cursor-usage-for-monitor";

export type CodexGuardrailMappedEntry = {
  usage: GuardrailMonitorUsageRow;
  credits: number;
  turns: number;
  clientIds: string[];
  /** Analytics `user_id` when email is not on the bucket (dedupe + display). */
  codexUserId: string | null;
};

/** Credits in one daily bucket that suggest premium/heavy posture for advisor rules. */
export const CODEX_GUARD_HIGH_CREDITS_PER_DAY = 20;

/** Turns below this with high credits → treat as non-complex heavy usage. */
export const CODEX_GUARD_LOW_TURNS_FOR_HEAVY = 40;

function dominantClient(
  clients: CodexUsageRow["clients"],
): { client_id: string; credits: number } | null {
  let best: { client_id: string; credits: number } | null = null;
  for (const c of clients ?? []) {
    const id = c.client_id?.trim();
    const credits = typeof c.credits === "number" && Number.isFinite(c.credits) ? c.credits : 0;
    if (!id || credits <= 0) continue;
    if (!best || credits > best.credits) best = { client_id: id, credits };
  }
  return best;
}

/** Infer a model label that satisfies CODEX allowlist and may trigger advisor rules. */
export function inferCodexModelForGuardrail(args: {
  credits: number;
  turns: number;
  dominantClientId: string | null;
}): string {
  const cid = args.dominantClientId?.toLowerCase() ?? "";
  if (cid.includes("max") || cid.includes("high") || cid.includes("pro")) {
    return "gpt-5-codex-max";
  }
  if (
    args.credits >= CODEX_GUARD_HIGH_CREDITS_PER_DAY &&
    args.turns < CODEX_GUARD_LOW_TURNS_FOR_HEAVY
  ) {
    return "gpt-5-codex-max";
  }
  return DAY_ONE_DEFAULT_MODEL.CODEX;
}

export function mapCodexUsageRowToGuardrailUsage(args: {
  row: CodexUsageRow;
  sinceMs: number;
  usdPerCredit: number;
  userIdToEmail?: ReadonlyMap<string, string>;
}): CodexGuardrailMappedEntry | null {
  const email = resolveCodexUsageRowEmail(args.row, args.userIdToEmail);

  const endMs = args.row.end_time * 1000;
  const startMs = args.row.start_time * 1000;
  if (endMs < args.sinceMs) return null;
  if (startMs > Date.now()) return null;

  const credits =
    typeof args.row.totals?.credits === "number" && Number.isFinite(args.row.totals.credits)
      ? args.row.totals.credits
      : 0;
  const turns =
    typeof args.row.totals?.turns === "number" && Number.isFinite(args.row.totals.turns)
      ? args.row.totals.turns
      : 0;
  if (credits <= 0 && turns <= 0) return null;

  const clientIds = (args.row.clients ?? [])
    .map((c) => c.client_id?.trim())
    .filter((id): id is string => Boolean(id));

  const dom = dominantClient(args.row.clients);
  const model = inferCodexModelForGuardrail({
    credits,
    turns,
    dominantClientId: dom?.client_id ?? null,
  });

  const tokensIn = Math.round(Math.max(turns, 1) * 500);
  const tokensOut = Math.round(Math.max(credits, 0.25) * 100);

  const codexUserId = args.row.user_id?.trim() || null;

  return {
    usage: {
      ts: new Date(endMs),
      product: Product.CODEX,
      model,
      tokensIn,
      tokensOut,
      decision: "ALLOWED",
      region: "global",
      costUsd: credits > 0 ? credits * args.usdPerCredit : null,
      userEmail: email ?? null,
      maxMode: model.toLowerCase().includes("max"),
    },
    credits,
    turns,
    clientIds,
    codexUserId,
  };
}
