import type { Prisma, Product } from "@prisma/client";

export const GUARDRAIL_PRODUCT_FILTER_ALL = "ALL";
export const GUARDRAIL_PRODUCT_FILTER_OTHER = "OTHER";

const KNOWN_PRODUCTS: readonly Product[] = [
  "CHATGPT",
  "CODEX",
  "CURSOR",
  "CLAUDE_AI",
  "M365_COPILOT",
];

export type GuardrailProductFilterValue =
  | typeof GUARDRAIL_PRODUCT_FILTER_ALL
  | typeof GUARDRAIL_PRODUCT_FILTER_OTHER
  | Product;

export function parseGuardrailProductFilter(
  raw: string | undefined,
): GuardrailProductFilterValue {
  if (!raw || raw.toUpperCase() === GUARDRAIL_PRODUCT_FILTER_ALL) {
    return GUARDRAIL_PRODUCT_FILTER_ALL;
  }
  const upper = raw.toUpperCase();
  if (upper === GUARDRAIL_PRODUCT_FILTER_OTHER) {
    return GUARDRAIL_PRODUCT_FILTER_OTHER;
  }
  if ((KNOWN_PRODUCTS as readonly string[]).includes(upper)) {
    return upper as Product;
  }
  return GUARDRAIL_PRODUCT_FILTER_ALL;
}

export function prismaWhereForGuardrailProductFilter(
  filter: GuardrailProductFilterValue,
): Prisma.GuardrailPolicyAlertWhereInput | undefined {
  if (filter === GUARDRAIL_PRODUCT_FILTER_ALL) return undefined;
  if (filter === GUARDRAIL_PRODUCT_FILTER_OTHER) return { product: null };
  return { product: filter };
}

export function guardrailProductFilterParam(
  filter: GuardrailProductFilterValue,
): string | undefined {
  if (filter === GUARDRAIL_PRODUCT_FILTER_ALL) return undefined;
  return filter === GUARDRAIL_PRODUCT_FILTER_OTHER ? "OTHER" : filter;
}
