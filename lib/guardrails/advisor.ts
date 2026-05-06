import type { Product } from "@prisma/client";
import {
  COMPLEXITY_SCORE_THRESHOLD_NON_COMPLEX,
  DAY_ONE_DEFAULT_MODEL,
  DISABLED_MODE_MARKERS,
  HEAVY_MODEL_MARKERS,
  MODEL_ALLOWLIST,
  type ProductKey,
} from "./day-one-defaults";

export type ComplexityClass = "NON_COMPLEX" | "COMPLEX";

export type AdvisorInput = {
  product: ProductKey;
  selectedModel: string;
  tokensIn?: number | null;
  tokensOut?: number | null;
  maxMode?: boolean;
  explicitComplexity?: number | null;
};

export type AdvisorOutcome = {
  complexityScore: number;
  complexityClass: ComplexityClass;
  defaultModel: string;
  heavyModel: boolean;
  allowedModel: boolean;
  disabledModeHit: boolean;
  recommendation: string | null;
  message: string | null;
};

export function estimateComplexityScore(input: AdvisorInput): number {
  if (typeof input.explicitComplexity === "number" && Number.isFinite(input.explicitComplexity)) {
    return Math.max(0, Math.min(1, input.explicitComplexity));
  }
  const tin = Math.max(0, input.tokensIn ?? 0);
  const tout = Math.max(0, input.tokensOut ?? 0);
  const maxFlag = input.maxMode ? 0.18 : 0;
  const tokenScore = Math.min(1, (tin / 6000) * 0.55 + (tout / 2500) * 0.45);
  return Math.max(0, Math.min(1, tokenScore + maxFlag));
}

function includesAny(haystack: string, needles: readonly string[]): boolean {
  const m = haystack.toLowerCase();
  return needles.some((n) => m.includes(n.toLowerCase()));
}

export function evaluateModelAdvisor(input: AdvisorInput): AdvisorOutcome {
  const selected = input.selectedModel.trim();
  const selectedLower = selected.toLowerCase();
  const defaultModel = DAY_ONE_DEFAULT_MODEL[input.product];
  const complexityScore = estimateComplexityScore(input);
  const complexityClass: ComplexityClass =
    complexityScore < COMPLEXITY_SCORE_THRESHOLD_NON_COMPLEX ? "NON_COMPLEX" : "COMPLEX";
  const heavyModel = includesAny(selectedLower, HEAVY_MODEL_MARKERS);
  const disabledModeHit = includesAny(selectedLower, DISABLED_MODE_MARKERS[input.product]);
  const allowedModel = MODEL_ALLOWLIST[input.product].test(selected);

  let recommendation: string | null = null;
  let message: string | null = null;

  if (!allowedModel) {
    recommendation = defaultModel;
    message = `Model is outside allowlist for ${input.product}; use ${defaultModel}.`;
  } else if (disabledModeHit) {
    recommendation = defaultModel;
    message = `Day-one policy disables fast/yolo/premium posture for ${input.product}.`;
  } else if (complexityClass === "NON_COMPLEX" && heavyModel) {
    recommendation = defaultModel;
    message =
      `This task looks non-complex (score ${complexityScore.toFixed(2)}); switch to ${defaultModel}.`;
  } else if (complexityClass === "NON_COMPLEX" && selectedLower !== defaultModel.toLowerCase()) {
    recommendation = defaultModel;
    message = `Non-complex task: default model for ${input.product} is ${defaultModel}.`;
  }

  return {
    complexityScore,
    complexityClass,
    defaultModel,
    heavyModel,
    allowedModel,
    disabledModeHit,
    recommendation,
    message,
  };
}

export function productFromUsageProduct(product: Product): ProductKey | null {
  if (product === "CHATGPT") return "CHATGPT";
  if (product === "CODEX") return "CODEX";
  if (product === "CURSOR") return "CURSOR";
  if (product === "CLAUDE_AI") return "CLAUDE_AI";
  if (product === "M365_COPILOT") return "M365_COPILOT";
  return null;
}
