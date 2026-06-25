import { describe, expect, it, vi } from "vitest";
import { fetchUnifiedCreditsPeriodLayers } from "./f1-unified-credits-live";
import { OPENAI_CREDIT_OVERAGE_USD } from "./program";

vi.mock("@/lib/integrations/openai-compliance/fetch", () => ({
  resolveUnifiedCreditsComplianceCredentials: () => ({
    apiKey: "k",
    principalId: "org-test",
    scope: "organizations" as const,
  }),
  listComplianceLogFiles: vi.fn(),
  downloadComplianceLogFile: vi.fn(),
}));

import {
  downloadComplianceLogFile,
  listComplianceLogFiles,
} from "@/lib/integrations/openai-compliance/fetch";

describe("fetchUnifiedCreditsPeriodLayers", () => {
  const env = {
    INTEGRATION_OPENAI_COMPLIANCE: "real",
    OPENAI_COMPLIANCE_API_KEY: "k",
    OPENAI_ORG_ID: "org-test",
  };

  it("returns null when compliance mode is synthetic", async () => {
    const out = await fetchUnifiedCreditsPeriodLayers({
      periodStart: new Date(2026, 5, 1),
      periodEnd: new Date(2026, 5, 25, 23, 59, 59),
      env: { INTEGRATION_OPENAI_COMPLIANCE: "synthetic" },
    });
    expect(out).toBeNull();
  });

  it("aggregates COSTS credits by day and product for the F1 window", async () => {
    vi.mocked(listComplianceLogFiles).mockResolvedValue({
      data: [{ id: "file-1", end_time: "2026-06-12T00:00:00Z" }],
      has_more: false,
      last_end_time: null,
    });
    vi.mocked(downloadComplianceLogFile).mockResolvedValue(
      [
        JSON.stringify({
          event_id: "evt-chat",
          type: "COSTS",
          payload: {
            day: "2026-06-11",
            hour: 10,
            product: "chatgpt",
            measures: {
              billing: [{ sku: "chat", cost: { value: 100_000, unit: "CREDITS" } }],
            },
          },
        }),
        JSON.stringify({
          event_id: "evt-cod",
          type: "COSTS",
          payload: {
            day: "2026-06-11",
            hour: 11,
            product: "codex",
            measures: {
              billing: [{ sku: "codex", cost: { value: 50_000, unit: "CREDITS" } }],
            },
          },
        }),
      ].join("\n"),
    );

    const out = await fetchUnifiedCreditsPeriodLayers({
      periodStart: new Date(2026, 5, 11),
      periodEnd: new Date(2026, 5, 11, 23, 59, 59),
      env,
    });

    expect(out).not.toBeNull();
    expect(out!.totalCredits).toBe(150_000);
    expect(out!.chatgptCredits).toBe(100_000);
    expect(out!.codexCredits).toBe(50_000);
    expect(out!.unifiedChatByYmd.get("2026-06-11")).toBeCloseTo(
      100_000 * OPENAI_CREDIT_OVERAGE_USD,
      5,
    );
  });
});
