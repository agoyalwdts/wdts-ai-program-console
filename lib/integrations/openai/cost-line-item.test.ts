import { describe, expect, it } from "vitest";
import { Product } from "@prisma/client";
import { buildCostLineItemClassifier } from "./cost-line-item";
import { MONTHLY_BUDGET_USD } from "@/lib/program";

describe("buildCostLineItemClassifier", () => {
  it("maps codex substrings to CODEX", () => {
    const c = buildCostLineItemClassifier({});
    expect(c.allocate("gpt-5.3-codex, input", 12)).toEqual([
      { product: Product.CODEX, usd: 12 },
    ]);
    expect(c.allocate("Some codex model", 3)).toEqual([{ product: Product.CODEX, usd: 3 }]);
  });

  it("applies OPENAI_COST_LINE_ITEM_SUBSTRINGS_JSON before defaults", () => {
    const c = buildCostLineItemClassifier({
      OPENAI_COST_LINE_ITEM_SUBSTRINGS_JSON: JSON.stringify({
        "special-chatgpt-sku": "CHATGPT",
        codex: "CHATGPT",
      }),
    });
    expect(c.allocate("my special-chatgpt-sku line", 5)).toEqual([
      { product: Product.CHATGPT, usd: 5 },
    ]);
    expect(c.allocate("prefix codex suffix", 1)).toEqual([{ product: Product.CHATGPT, usd: 1 }]);
  });

  it("splits unmapped spend by MONTHLY_BUDGET_USD ratio", () => {
    const c = buildCostLineItemClassifier({});
    const out = c.allocate("gpt-4o, input", 100);
    expect(out).toHaveLength(2);
    const cg = out.find((x) => x.product === Product.CHATGPT)!.usd;
    const cx = out.find((x) => x.product === Product.CODEX)!.usd;
    expect(cg + cx).toBeCloseTo(100, 5);
    expect(cg / cx).toBeCloseTo(MONTHLY_BUDGET_USD.CHATGPT / MONTHLY_BUDGET_USD.CODEX, 5);
  });

  it("honours OPENAI_COST_UNMAPPED_SPLIT", () => {
    const c = buildCostLineItemClassifier({ OPENAI_COST_UNMAPPED_SPLIT: "CODEX" });
    expect(c.allocate("unknown api line", 7)).toEqual([{ product: Product.CODEX, usd: 7 }]);
  });
});
