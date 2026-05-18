import { describe, expect, it, vi } from "vitest";
import { enrichCodexSeatsFromEnterpriseAnalytics } from "./enrich-codex-seats-from-analytics";
import type { CodexSeat } from "@/lib/integrations/openai/types";

const mockFetchPerUser = vi.fn();

vi.mock("./fetch-workspace-usage", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./fetch-workspace-usage")>();
  return {
    ...orig,
    fetchCodexEnterprisePerUserUsageRows: (...args: unknown[]) => mockFetchPerUser(...args),
  };
});

const seat: CodexSeat = {
  userId: "u1",
  email: "alice@wdts.com",
  displayName: "Alice",
  subTier: "STANDARD",
  capUsdMonth: 1400,
  mtdSpendUsd: 0,
  lastActivityTs: null,
  idleDays: null,
};

const ENV_REAL = {
  INTEGRATION_CODEX_ENTERPRISE_ANALYTICS: "real",
  OPENAI_CODEX_ANALYTICS_API_KEY: "sk-test",
  CHATGPT_WORKSPACE_ID: "ws-1",
  OPENAI_CODEX_ANALYTICS_USD_PER_CREDIT: "0.1",
};

describe("enrichCodexSeatsFromEnterpriseAnalytics", () => {
  it("no-ops when integration is synthetic", async () => {
    mockFetchPerUser.mockReset();
    const out = await enrichCodexSeatsFromEnterpriseAnalytics([seat], {
      env: { INTEGRATION_CODEX_ENTERPRISE_ANALYTICS: "synthetic" },
    });
    expect(out[0]?.mtdSpendUsd).toBe(0);
    expect(mockFetchPerUser).not.toHaveBeenCalled();
  });

  it("overrides MTD when per-user rows match email", async () => {
    const now = new Date(2024, 10, 20, 12, 0, 0);
    const monthStartSec = Math.floor(new Date(2024, 10, 16).getTime() / 1000);
    const rowStart = monthStartSec + 86_400;
    mockFetchPerUser.mockResolvedValue([
      {
        object: "user.codex.usage.result",
        start_time: rowStart,
        end_time: rowStart + 86_400,
        email: "alice@wdts.com",
        totals: { threads: 1, turns: 1, credits: 50 },
        clients: [],
      },
    ]);
    const out = await enrichCodexSeatsFromEnterpriseAnalytics([seat], {
      env: ENV_REAL,
      now,
    });
    expect(out[0]?.mtdSpendUsd).toBe(5);
    expect(out[0]?.lastActivityTs).toEqual(new Date((rowStart + 86_400) * 1000));
    expect(out[0]?.idleDays).toBeGreaterThanOrEqual(0);
  });
});
