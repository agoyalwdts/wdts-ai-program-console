/** Minimum event cost (USD) before complexity-advisor rules create alerts. */
export const DEFAULT_GUARDRAIL_MIN_COST_USD = 1;

const COMPLEXITY_ADVISOR_COST_GATED_RULES = new Set([
  "NON_COMPLEX_HEAVY_MODEL_SELECTED",
  "NON_COMPLEX_NON_DEFAULT_MODEL",
]);

/** Vendor feeds without cloud routing metadata — skip region allowlist checks. */
const REGION_CHECK_SKIP_SOURCES = new Set([
  "CURSOR_ADMIN_API",
  "CODEX_ENTERPRISE_ANALYTICS",
]);

export function resolveGuardrailMinCostUsd(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.GUARDRAIL_MIN_COST_USD?.trim();
  if (!raw) return DEFAULT_GUARDRAIL_MIN_COST_USD;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_GUARDRAIL_MIN_COST_USD;
  return n;
}

export function shouldSkipRegionAllowlistCheck(source: string, region: string): boolean {
  if (REGION_CHECK_SKIP_SOURCES.has(source)) return true;
  const r = region.trim().toLowerCase();
  return r === "global" || r === "unknown" || r === "";
}

export function passesGuardrailCostFloor(args: {
  ruleCode: string;
  costUsd: number | null | undefined;
  minCostUsd: number;
}): boolean {
  if (!COMPLEXITY_ADVISOR_COST_GATED_RULES.has(args.ruleCode)) return true;
  return (args.costUsd ?? 0) >= args.minCostUsd;
}
