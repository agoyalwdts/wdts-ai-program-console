import { describe, expect, it, vi, beforeEach } from "vitest";

const fetchRows = vi.fn();

vi.mock("../env", () => ({
  getIntegrationMode: vi.fn(() => "real"),
}));

vi.mock("./fetch-workspace-usage", () => ({
  resolveCodexEnterpriseAnalyticsCredentials: vi.fn(() => ({
    apiKey: "k",
    workspaceId: "ws",
  })),
  fetchCodexEnterprisePerUserUsageRows: fetchRows,
}));

beforeEach(() => {
  fetchRows.mockReset();
});

describe("summarizeCodexClientsForEmail", () => {
  it("aggregates distinct client_id for matching email", async () => {
    fetchRows.mockResolvedValue([
      {
        object: "x",
        start_time: 1,
        end_time: 2,
        email: "dev@wdtablesystems.com",
        totals: { threads: 1, turns: 1, credits: 1 },
        clients: [{ client_id: "CODEX_CLI" }, { client_id: "vscode" }],
      },
      {
        object: "x",
        start_time: 3,
        end_time: 4,
        email: "dev@wdtablesystems.com",
        totals: { threads: 1, turns: 1, credits: 1 },
        clients: [{ client_id: "CODEX_CLI" }],
      },
      {
        object: "x",
        start_time: 5,
        end_time: 6,
        email: "other@wdtablesystems.com",
        totals: { threads: 1, turns: 1, credits: 1 },
        clients: [{ client_id: "CODEX_CLI" }],
      },
    ]);

    const { summarizeCodexClientsForEmail } = await import("./distinct-clients-by-email");
    const summary = await summarizeCodexClientsForEmail({
      email: "dev@wdtablesystems.com",
      now: new Date("2026-05-22T12:00:00Z"),
      env: {
        INTEGRATION_CODEX_ENTERPRISE_ANALYTICS: "real",
        OPENAI_CODEX_ANALYTICS_API_KEY: "k",
        CHATGPT_WORKSPACE_ID: "ws",
      },
    });

    expect(summary.available).toBe(true);
    if (summary.available) {
      expect(summary.distinctClients).toEqual(["CODEX_CLI", "vscode"]);
    }
  });
});
