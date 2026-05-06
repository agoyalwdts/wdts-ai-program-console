import { describe, expect, it, vi } from "vitest";
import {
  fetchCodexEnterpriseWorkspaceUsageRows,
  resolveCodexEnterpriseAnalyticsCredentials,
  resolveUsdPerCredit,
} from "./fetch-workspace-usage";

describe("resolveCodexEnterpriseAnalyticsCredentials", () => {
  it("returns null when api key missing", () => {
    expect(
      resolveCodexEnterpriseAnalyticsCredentials({
        CHATGPT_WORKSPACE_ID: "152420ca-b38f-4040-9346-e704aaa63ed5",
      }),
    ).toBeNull();
  });

  it("prefers CHATGPT_WORKSPACE_ID over OPENAI_CHATGPT_WORKSPACE_ID", () => {
    const c = resolveCodexEnterpriseAnalyticsCredentials({
      OPENAI_CODEX_ANALYTICS_API_KEY: "sk-test",
      CHATGPT_WORKSPACE_ID: "aaa",
      OPENAI_CHATGPT_WORKSPACE_ID: "bbb",
    });
    expect(c?.workspaceId).toBe("aaa");
  });
});

describe("resolveUsdPerCredit", () => {
  it("defaults to contract credit rate", () => {
    expect(resolveUsdPerCredit({})).toBe(0.04);
  });
});

describe("fetchCodexEnterpriseWorkspaceUsageRows", () => {
  it("aggregates pages until has_more false", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      calls += 1;
      const u = new URL(url);
      const page = u.searchParams.get("page");
      if (!page) {
        return {
          ok: true,
          json: async () => ({
            object: "page",
            data: [
              {
                object: "workspace.codex.usage.result",
                start_time: 1_730_419_200,
                end_time: 1_730_505_600,
                totals: { threads: 1, turns: 2, credits: 3 },
                clients: [],
              },
            ],
            has_more: true,
            next_page: "cursor1",
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          object: "page",
          data: [
            {
              object: "workspace.codex.usage.result",
              start_time: 1_730_505_600,
              end_time: 1_730_592_000,
              totals: { threads: 1, turns: 1, credits: 1 },
              clients: [],
            },
          ],
          has_more: false,
          next_page: null,
        }),
      } as Response;
    });

    const rows = await fetchCodexEnterpriseWorkspaceUsageRows({
      startTimeSec: 1_730_419_200,
      endTimeSec: 1_730_592_000,
      creds: { apiKey: "k", workspaceId: "152420ca-b38f-4040-9346-e704aaa63ed5" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(calls).toBe(2);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.totals.credits).toBe(3);
    expect(rows[1]!.totals.credits).toBe(1);
  });
});
