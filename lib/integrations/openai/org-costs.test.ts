import { describe, expect, it } from "vitest";
import { Product } from "@prisma/client";
import { fetchOpenAiOrgCostsByLocalDay } from "./org-costs";
import { buildCostLineItemClassifier } from "./cost-line-item";

describe("fetchOpenAiOrgCostsByLocalDay", () => {
  it("paginates with next_page and aggregates by local day key", async () => {
    let page = 0;
    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      expect(url).toContain("/v1/organization/costs");
      page += 1;
      if (page === 1) {
        expect(url).not.toContain("page=");
        return new Response(
          JSON.stringify({
            data: [
              {
                start_time: 86400,
                end_time: 172800,
                results: [{ line_item: "evals | thing", amount: { value: 4 } }],
              },
            ],
            next_page: "cursor-2",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      expect(url).toContain("page=cursor-2");
      return new Response(
        JSON.stringify({
          data: [
            {
              start_time: 172800,
              end_time: 259200,
              results: [{ line_item: "o3-codex-mini", amount: { value: 6 } }],
            },
          ],
          next_page: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const { byDay, sourceCostLines } = await fetchOpenAiOrgCostsByLocalDay({
      startTimeSec: 0,
      endTimeSec: 400000,
      creds: { apiKey: "sk-test", orgId: "org-test" },
      classifier: buildCostLineItemClassifier({ OPENAI_COST_UNMAPPED_SPLIT: "CHATGPT" }),
      toLocalYmd: (ms) => {
        const d = new Date(ms);
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      },
      fetchImpl,
      maxPages: 10,
    });

    expect(sourceCostLines).toBe(2);
    expect(page).toBe(2);

    const day1 = byDay.get("1970-01-02");
    expect(day1).toBeDefined();
    expect(day1![Product.CHATGPT].spendUsd).toBeCloseTo(4, 5);
    expect(day1![Product.CODEX].spendUsd).toBe(0);

    const day2 = byDay.get("1970-01-03");
    expect(day2).toBeDefined();
    expect(day2![Product.CODEX].spendUsd).toBeCloseTo(6, 5);
  });
});
