import type { CursorUsageParsedRow, PrudenceEvaluation } from "./types";

function modelLower(row: CursorUsageParsedRow): string {
  return row.model.toLowerCase();
}

/** Opus-class models with stacked premium modifiers (max / thinking / fast). */
function ruleOpusPremiumStackLowOutput(
  row: CursorUsageParsedRow,
): PrudenceEvaluation | null {
  const m = modelLower(row);
  if (!m.includes("opus")) return null;
  const stacked =
    (m.includes("max") && m.includes("thinking")) ||
    m.includes("max-thinking") ||
    m.includes("opus-max");
  if (!stacked) return null;
  if (!row.maxMode) return null;
  if (row.cacheRead < 400_000) return null;
  if (row.outputTokens >= 35_000) return null;
  if (row.costUsd < 2.5) return null;
  return {
    ruleCode: "OPUS_MAX_THINKING_LOW_OUTPUT_VS_CACHE",
    title: "Opus + Max/Thinking with modest output vs large cache read",
    rationale:
      "Model name stacks premium tiers (max / thinking); Max mode is on; cache read is high but completion output is relatively small vs cost — review whether a lighter model or non-Max mode would suffice.",
  };
}

/** xhigh / extreme thinking — flag material spend or low output vs tier. */
function ruleThinkingXhigh(row: CursorUsageParsedRow): PrudenceEvaluation | null {
  const m = modelLower(row);
  if (!m.includes("xhigh") && !m.includes("thinking-xhigh")) return null;
  if (row.costUsd >= 6 && row.outputTokens < 50_000) {
    return {
      ruleCode: "THINKING_XHIGH_HIGH_COST_LOW_OUTPUT",
      title: "thinking-xhigh tier with high cost vs output size",
      rationale:
        "The xhigh / extreme thinking tier is priced for the heaviest workloads; this row shows substantial USD spend with moderate output tokens — confirm the task required this tier.",
    };
  }
  if (row.costUsd >= 1.25 && row.outputTokens < 18_000) {
    return {
      ruleCode: "THINKING_XHIGH_MODERATE_COST_LOW_OUTPUT",
      title: "thinking-xhigh with limited output",
      rationale:
        "xhigh / extreme thinking model with relatively small output for the tier — worth a coaching nudge unless this was intentional (e.g. short but safety-critical).",
    };
  }
  return null;
}

/** Max mode on + meaningful bill + completion not huge. */
function ruleMaxModeHighCost(row: CursorUsageParsedRow): PrudenceEvaluation | null {
  if (!row.maxMode) return null;
  if (row.costUsd < 4) return null;
  if (row.outputTokens >= 28_000) return null;
  return {
    ruleCode: "MAX_MODE_HIGH_COST_SMALL_OUTPUT",
    title: "Max mode with high $ cost and modest output",
    rationale:
      "Max mode multiplies context/cost; billed amount is elevated while generated output tokens are modest — check if Max was necessary for this turn.",
  };
}

const RULES: ReadonlyArray<
  (row: CursorUsageParsedRow) => PrudenceEvaluation | null
> = [
  ruleOpusPremiumStackLowOutput,
  ruleThinkingXhigh,
  ruleMaxModeHighCost,
];

/**
 * Returns the first matching prudence rule for the row, or null if none.
 * Rules are ordered by specificity (stacked Opus first).
 */
export function evaluatePrudence(
  row: CursorUsageParsedRow,
): PrudenceEvaluation | null {
  for (const r of RULES) {
    const hit = r(row);
    if (hit) return hit;
  }
  return null;
}
