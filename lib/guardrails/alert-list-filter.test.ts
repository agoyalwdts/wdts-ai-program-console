import { describe, expect, it } from "vitest";
import {
  GUARDRAIL_ACK_FILTER_OPEN,
  GUARDRAIL_SEVERITY_FILTER_MEDIUM_UP,
  parseGuardrailListFilter,
  prismaWhereForGuardrailListFilter,
} from "./alert-list-filter";

describe("parseGuardrailListFilter", () => {
  it("defaults to open MEDIUM+ alerts", () => {
    expect(parseGuardrailListFilter({})).toEqual({
      product: "ALL",
      severity: GUARDRAIL_SEVERITY_FILTER_MEDIUM_UP,
      ack: GUARDRAIL_ACK_FILTER_OPEN,
    });
  });
});

describe("prismaWhereForGuardrailListFilter", () => {
  it("combines product, severity, and ack filters", () => {
    const where = prismaWhereForGuardrailListFilter(
      parseGuardrailListFilter({ product: "CURSOR", severity: "HIGH", ack: "OPEN" }),
    );
    expect(where).toEqual({
      AND: [{ product: "CURSOR" }, { severity: "HIGH" }, { acknowledgedAt: null }],
    });
  });
});
