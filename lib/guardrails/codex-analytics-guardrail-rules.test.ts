import { describe, expect, it } from "vitest";
import { GUARDRAIL_CATEGORY } from "./categories";
import { pushCodexAnalyticsGuardrailCandidates } from "./codex-analytics-guardrail-rules";
import type { GuardrailCandidate } from "./types";

function dedupe(parts: readonly string[]) {
  return parts.join("|");
}

describe("pushCodexAnalyticsGuardrailCandidates", () => {
  it("emits high-credits and multi-client rules", () => {
    const candidates: GuardrailCandidate[] = [];
    pushCodexAnalyticsGuardrailCandidates({
      candidates,
      occurredAt: new Date("2026-05-27T12:00:00Z"),
      environment: "prod",
      userEmail: "dev@wdtablesystems.com",
      model: "gpt-5-codex-medium",
      credits: 25,
      turns: 10,
      clientIds: ["codex-cli", "vscode"],
      costUsd: 1.75,
      dedupe,
    });
    const codes = candidates.map((c) => c.ruleCode);
    expect(codes).toContain("CODEX_HIGH_DAILY_CREDITS");
    expect(codes).toContain("CODEX_MULTI_CLIENT_SURFACE");
    expect(candidates.every((c) => c.product === "CODEX")).toBe(true);
    const high = candidates.find((c) => c.ruleCode === "CODEX_HIGH_DAILY_CREDITS");
    expect(high?.category).toBe(GUARDRAIL_CATEGORY.USAGE_POSTURE);
    expect(high?.category).not.toBe(GUARDRAIL_CATEGORY.COMPLEXITY_ADVISOR);
  });

  it("dedupes by codex user_id when email is missing", () => {
    const candidates: GuardrailCandidate[] = [];
    pushCodexAnalyticsGuardrailCandidates({
      candidates,
      occurredAt: new Date("2026-05-27T12:00:00Z"),
      environment: "prod",
      userEmail: null,
      codexUserId: "user-abc",
      model: "gpt-5-codex-medium",
      credits: 25,
      turns: 10,
      clientIds: [],
      costUsd: null,
      dedupe,
    });
    expect(candidates[0]?.dedupeKey).toContain("user-abc");
    expect(candidates[0]?.dedupeKey).not.toContain("|unknown|");
  });
});
