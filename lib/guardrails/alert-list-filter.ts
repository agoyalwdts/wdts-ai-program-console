import type { Prisma } from "@prisma/client";
import {
  GUARDRAIL_PRODUCT_FILTER_ALL,
  type GuardrailProductFilterValue,
  parseGuardrailProductFilter,
  prismaWhereForGuardrailProductFilter,
} from "./alert-product-filter";

export const GUARDRAIL_SEVERITY_FILTER_MEDIUM_UP = "MEDIUM_UP";
export const GUARDRAIL_SEVERITY_FILTER_ALL = "ALL";
export const GUARDRAIL_ACK_FILTER_OPEN = "OPEN";
export const GUARDRAIL_ACK_FILTER_ALL = "ALL";

export type GuardrailSeverityFilterValue =
  | typeof GUARDRAIL_SEVERITY_FILTER_MEDIUM_UP
  | typeof GUARDRAIL_SEVERITY_FILTER_ALL
  | "HIGH";

export type GuardrailAckFilterValue =
  | typeof GUARDRAIL_ACK_FILTER_OPEN
  | typeof GUARDRAIL_ACK_FILTER_ALL;

export type GuardrailListFilter = {
  product: GuardrailProductFilterValue;
  severity: GuardrailSeverityFilterValue;
  ack: GuardrailAckFilterValue;
};

export function parseGuardrailSeverityFilter(
  raw: string | undefined,
): GuardrailSeverityFilterValue {
  if (!raw) return GUARDRAIL_SEVERITY_FILTER_MEDIUM_UP;
  const upper = raw.toUpperCase();
  if (upper === GUARDRAIL_SEVERITY_FILTER_ALL) return GUARDRAIL_SEVERITY_FILTER_ALL;
  if (upper === "HIGH") return "HIGH";
  if (upper === GUARDRAIL_SEVERITY_FILTER_MEDIUM_UP || upper === "MEDIUM") {
    return GUARDRAIL_SEVERITY_FILTER_MEDIUM_UP;
  }
  return GUARDRAIL_SEVERITY_FILTER_MEDIUM_UP;
}

export function parseGuardrailAckFilter(raw: string | undefined): GuardrailAckFilterValue {
  if (!raw) return GUARDRAIL_ACK_FILTER_OPEN;
  const upper = raw.toUpperCase();
  if (upper === GUARDRAIL_ACK_FILTER_ALL) return GUARDRAIL_ACK_FILTER_ALL;
  return GUARDRAIL_ACK_FILTER_OPEN;
}

export function parseGuardrailListFilter(searchParams: {
  product?: string;
  severity?: string;
  ack?: string;
}): GuardrailListFilter {
  return {
    product: parseGuardrailProductFilter(searchParams.product),
    severity: parseGuardrailSeverityFilter(searchParams.severity),
    ack: parseGuardrailAckFilter(searchParams.ack),
  };
}

export function prismaWhereForGuardrailListFilter(
  filter: GuardrailListFilter,
): Prisma.GuardrailPolicyAlertWhereInput {
  const parts: Prisma.GuardrailPolicyAlertWhereInput[] = [];

  const productWhere = prismaWhereForGuardrailProductFilter(filter.product);
  if (productWhere) parts.push(productWhere);

  if (filter.severity === GUARDRAIL_SEVERITY_FILTER_MEDIUM_UP) {
    parts.push({ severity: { in: ["MEDIUM", "HIGH"] } });
  } else if (filter.severity === "HIGH") {
    parts.push({ severity: "HIGH" });
  }

  if (filter.ack === GUARDRAIL_ACK_FILTER_OPEN) {
    parts.push({ acknowledgedAt: null });
  }

  if (parts.length === 0) return {};
  if (parts.length === 1) return parts[0]!;
  return { AND: parts };
}

export function guardrailListFilterSearchParams(filter: GuardrailListFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.product !== GUARDRAIL_PRODUCT_FILTER_ALL) {
    params.set("product", filter.product === "OTHER" ? "OTHER" : filter.product);
  }
  if (filter.severity !== GUARDRAIL_SEVERITY_FILTER_MEDIUM_UP) {
    params.set("severity", filter.severity);
  }
  if (filter.ack !== GUARDRAIL_ACK_FILTER_OPEN) {
    params.set("ack", filter.ack);
  }
  return params;
}
