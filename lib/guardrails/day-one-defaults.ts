import type { Product } from "@prisma/client";

export type ProductKey = Extract<
  Product,
  "CHATGPT" | "CODEX" | "CURSOR" | "CLAUDE_AI" | "M365_COPILOT"
>;

/** Day-one posture defaults: conservative by default; upgrade only on need. */
export const DAY_ONE_DEFAULT_MODEL: Record<ProductKey, string> = {
  CHATGPT: "gpt-5.3",
  CODEX: "gpt-5-codex-medium",
  CURSOR: "composer-2.5-fast",
  CLAUDE_AI: "claude-4.6-sonnet",
  M365_COPILOT: "m365-copilot-default",
};

/** Explicitly disabled runtime modes for day-one spend control. */
export const DISABLED_MODE_MARKERS: Record<ProductKey, readonly string[]> = {
  CHATGPT: ["pro", "thinking-xhigh"],
  CODEX: ["fast", "yolo", "thinking-xhigh"],
  CURSOR: ["fast", "yolo", "max-thinking"],
  CLAUDE_AI: ["opus-max"],
  M365_COPILOT: [],
};

/** Heavy/costly model markers used by complexity-aware advisor and monitor. */
export const HEAVY_MODEL_MARKERS = [
  "opus",
  "max",
  "thinking",
  "xhigh",
  "pro",
  "o3",
  "gpt-5.5",
] as const;

/**
 * Provider/model allowlist. If a model fails this regex, monitor raises
 * UNAPPROVED_MODEL_ENDPOINT in strict environments.
 */
export const MODEL_ALLOWLIST: Record<ProductKey, RegExp> = {
  CHATGPT: /^(gpt-4\.1|gpt-5|gpt-5\.\d|o1|o3|o4|chatgpt-)/i,
  CODEX: /^(gpt-5-codex|codex|gpt-5|o3)/i,
  CURSOR: /^(claude|gpt-4\.1|gpt-5|gemini|composer|auto|default)/i,
  CLAUDE_AI: /^(claude)/i,
  M365_COPILOT: /^(m365|copilot)/i,
};

/** Production/staging cloud-region constraints. */
export const STRICT_REGION_ALLOWLIST = [
  "centralindia",
  "southeastasia",
  "eastus",
  "westeurope",
] as const;

export const COMPLEXITY_SCORE_THRESHOLD_NON_COMPLEX = 0.35;

/**
 * Canonical pseudo-rule block for Product/Platform alignment.
 * Keep this verbatim when wiring gateway pre-run nudges.
 */
export const COMPLEXITY_ADVISOR_PSEUDO_RULE = `
if complexity_score < 0.35 and selected_model in HEAVY_MODELS:
  show_pre_run_alert("This looks non-complex; switch to cheaper default model")
  recommendation = DEFAULT_MODEL_BY_PRODUCT[product]
  if user_overrides >= 3 in rolling_7d:
    create_finops_alert(severity="medium", rule="REPEATED_NON_COMPLEX_OVERRIDE")
`;
