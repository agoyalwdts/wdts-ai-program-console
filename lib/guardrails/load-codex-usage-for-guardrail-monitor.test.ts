import { describe, expect, it, vi } from "vitest";
import { loadCodexUsageForGuardrailMonitor } from "./load-codex-usage-for-guardrail-monitor";

vi.mock("@/lib/integrations/codex-enterprise-analytics/fetch-workspace-usage", () => ({
  resolveCodexEnterpriseAnalyticsCredentials: vi.fn(() => ({
    apiKey: "key",
    workspaceId: "ws-1",
  })),
  resolveUsdPerCredit: vi.fn(() => 0.05),
  fetchCodexEnterprisePerUserUsageRows: vi.fn(async () => [
    {
      object: "usage",
      start_time: Math.floor(Date.now() / 1000) - 3600,
      end_time: Math.floor(Date.now() / 1000),
      email: "coder@wdtablesystems.com",
      totals: { threads: 1, turns: 8, credits: 25 },
      clients: [{ client_id: "codex-cli", credits: 25, turns: 8 }],
    },
  ]),
}));

describe("loadCodexUsageForGuardrailMonitor", () => {
  it("returns inactive when integration is not real", async () => {
    const out = await loadCodexUsageForGuardrailMonitor({
      since: new Date(Date.now() - 86_400_000),
      env: { INTEGRATION_CODEX_ENTERPRISE_ANALYTICS: "synthetic" },
    });
    expect(out.active).toBe(false);
    if (!out.active) expect(out.reason).toContain("not real");
  });

  it("loads rows when integration is real", async () => {
    const out = await loadCodexUsageForGuardrailMonitor({
      since: new Date(Date.now() - 86_400_000),
      env: { INTEGRATION_CODEX_ENTERPRISE_ANALYTICS: "real" },
    });
    expect(out.active).toBe(true);
    if (out.active) {
      expect(out.rowsInWindow).toBe(1);
      expect(out.rows[0]?.product).toBe("CODEX");
      expect(out.rows[0]?.userEmail).toBe("coder@wdtablesystems.com");
    }
  });
});
