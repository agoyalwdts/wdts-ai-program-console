import { describe, expect, it } from "vitest";
import {
  GUARDRAIL_PRODUCT_FILTER_ALL,
  parseGuardrailProductFilter,
  prismaWhereForGuardrailProductFilter,
} from "./alert-product-filter";

describe("parseGuardrailProductFilter", () => {
  it("defaults to ALL", () => {
    expect(parseGuardrailProductFilter(undefined)).toBe(GUARDRAIL_PRODUCT_FILTER_ALL);
    expect(parseGuardrailProductFilter("all")).toBe(GUARDRAIL_PRODUCT_FILTER_ALL);
  });

  it("parses known products", () => {
    expect(parseGuardrailProductFilter("codex")).toBe("CODEX");
    expect(prismaWhereForGuardrailProductFilter("CODEX")).toEqual({ product: "CODEX" });
  });

  it("parses OTHER as null product", () => {
    expect(parseGuardrailProductFilter("other")).toBe("OTHER");
    expect(prismaWhereForGuardrailProductFilter("OTHER")).toEqual({ product: null });
  });
});
