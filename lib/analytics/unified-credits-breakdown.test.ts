import { describe, expect, it } from "vitest";
import { aggregateUnifiedCreditsRows } from "./unified-credits-breakdown";
import type { UnifiedCreditsRow } from "@/lib/integrations/unified-credits/types";

describe("aggregateUnifiedCreditsRows", () => {
  it("rolls up SKU, model, and surface", () => {
    const rows: UnifiedCreditsRow[] = [
      {
        event_id: "e1",
        day: "2026-05-01",
        hour: 12,
        model: "gpt-4.1",
        surface: "chat",
        billing: [{ sku: "chatgpt_plus", credits: 10 }],
        credits_total: 10,
        raw: {},
      },
      {
        event_id: "e2",
        day: "2026-05-01",
        hour: 13,
        model: "gpt-4.1",
        client: "api",
        billing: [{ sku: "chatgpt_plus", credits: 5 }, { sku: "tools", credits: 3 }],
        credits_total: 8,
        raw: {},
      },
    ];

    const agg = aggregateUnifiedCreditsRows(rows, 0.01);
    expect(agg.bySku[0]).toMatchObject({ key: "chatgpt_plus", credits: 15 });
    expect(agg.byModel[0]).toMatchObject({ key: "gpt-4.1", credits: 18 });
    expect(agg.totalCredits).toBe(18);
  });
});
