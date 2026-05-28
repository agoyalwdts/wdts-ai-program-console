/**
 * GuardrailPolicyAlert.category values (string column; not a Prisma enum).
 */

export const GUARDRAIL_CATEGORY = {
  MODEL_POSTURE: "MODEL_POSTURE",
  COMPLEXITY_ADVISOR: "COMPLEXITY_ADVISOR",
  CLOUD_CONTROL: "CLOUD_CONTROL",
  /** Credit / spend signals from Codex Enterprise Analytics (not per-request model advisor). */
  USAGE_POSTURE: "USAGE_POSTURE",
} as const;

export type GuardrailCategory =
  (typeof GUARDRAIL_CATEGORY)[keyof typeof GUARDRAIL_CATEGORY];

export const GUARDRAIL_CATEGORY_LABEL: Record<GuardrailCategory, string> = {
  MODEL_POSTURE: "Model posture",
  COMPLEXITY_ADVISOR: "Complexity advisor",
  CLOUD_CONTROL: "Cloud control",
  USAGE_POSTURE: "Usage / credits",
};

const CODEX_ANALYTICS_RULE_CODES = new Set([
  "CODEX_HIGH_DAILY_CREDITS",
  "CODEX_ELEVATED_DAILY_CREDITS",
  "CODEX_MULTI_CLIENT_SURFACE",
]);

/** Display label; maps legacy mis-tagged Codex analytics rows to Usage / credits. */
export function guardrailCategoryLabel(category: string, ruleCode?: string): string {
  if (
    ruleCode &&
    CODEX_ANALYTICS_RULE_CODES.has(ruleCode) &&
    category !== GUARDRAIL_CATEGORY.USAGE_POSTURE
  ) {
    return GUARDRAIL_CATEGORY_LABEL.USAGE_POSTURE;
  }
  return GUARDRAIL_CATEGORY_LABEL[category as GuardrailCategory] ?? category;
}
