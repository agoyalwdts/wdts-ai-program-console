import { describe, expect, it, vi } from "vitest";
import { loadCodexEnterpriseSpendForF1 } from "./f1-codex-enterprise-analytics";

const mockFetchWorkspace = vi.fn();

vi.mock("@/lib/integrations/codex-enterprise-analytics/fetch-workspace-usage", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/integrations/codex-enterprise-analytics/fetch-workspace-usage")>();
  return {
    ...orig,
    fetchCodexEnterpriseWorkspaceUsageRows: (...args: unknown[]) => mockFetchWorkspace(...args),
  };
});

const ENV = {
  INTEGRATION_CODEX_ENTERPRISE_ANALYTICS: "real",
  OPENAI_CODEX_ANALYTICS_API_KEY: "sk-test",
  CHATGPT_WORKSPACE_ID: "ws-1",
  OPENAI_CODEX_ANALYTICS_USD_PER_CREDIT: "0.1",
};

describe("loadCodexEnterpriseSpendForF1", () => {
  it("uses live API when creds are set", async () => {
    mockFetchWorkspace.mockResolvedValue([
      {
        object: "workspace.codex.usage.result",
        start_time: Math.floor(new Date(2026, 4, 18, 0, 0, 0).getTime() / 1000),
        end_time: Math.floor(new Date(2026, 4, 19, 0, 0, 0).getTime() / 1000),
        totals: { threads: 1, turns: 1, credits: 100 },
        clients: [],
      },
    ]);

    const prisma = {
      vendorDailySpend: { findMany: vi.fn() },
    } as unknown as import("@prisma/client").PrismaClient;

    const result = await loadCodexEnterpriseSpendForF1(prisma, {
      periodStart: new Date(2026, 4, 16),
      periodEnd: new Date(2026, 4, 20, 12, 0, 0),
      env: ENV,
    });

    expect(result.source).toBe("live");
    expect(result.usedVendor).toBe(true);
    expect(result.periodTotalUsd).toBe(10);
    expect(prisma.vendorDailySpend.findMany).not.toHaveBeenCalled();
  });

  it("falls back to VendorDailySpend when live fetch throws", async () => {
    mockFetchWorkspace.mockRejectedValue(new Error("401"));
    const findMany = vi.fn().mockResolvedValue([
      {
        day: new Date(2026, 4, 18, 12, 0, 0),
        spendUsd: 42,
      },
    ]);
    const prisma = { vendorDailySpend: { findMany } } as unknown as import("@prisma/client").PrismaClient;

    const result = await loadCodexEnterpriseSpendForF1(prisma, {
      periodStart: new Date(2026, 4, 16),
      periodEnd: new Date(2026, 4, 20),
      env: ENV,
    });

    expect(result.source).toBe("sync");
    expect(result.periodTotalUsd).toBe(42);
    expect(findMany).toHaveBeenCalled();
  });
});
