import { describe, expect, it, vi } from "vitest";
import { syncUnifiedCredits } from "./sync";

vi.mock("../openai-compliance/fetch", () => ({
  resolveComplianceCredentials: () => ({
    apiKey: "k",
    principalId: "ws-1",
    scope: "workspaces" as const,
  }),
  listComplianceLogFiles: vi.fn(),
  downloadComplianceLogFile: vi.fn(),
}));

import {
  downloadComplianceLogFile,
  listComplianceLogFiles,
} from "../openai-compliance/fetch";

describe("syncUnifiedCredits", () => {
  const prisma = {
    programVendorExportSnapshot: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    vendorDailySpend: { upsert: vi.fn().mockResolvedValue({}) },
    vendorUserDailySpend: { upsert: vi.fn().mockResolvedValue({}) },
    decision: { create: vi.fn().mockResolvedValue({}) },
  };

  it("returns notEnabled when API rejects COSTS event_type", async () => {
    vi.mocked(listComplianceLogFiles).mockRejectedValue(
      new Error('GET compliance logs → 400 Bad Request: {"detail":"Invalid event_type COSTS"}'),
    );

    const out = await syncUnifiedCredits(prisma as never, {
      actorEmail: "test@wdts.com",
      env: { INTEGRATION_OPENAI_COMPLIANCE: "real", OPENAI_COMPLIANCE_API_KEY: "k", CHATGPT_WORKSPACE_ID: "ws" },
      skipDecision: true,
    });

    expect(out.ok).toBe(false);
    expect(out.notEnabled).toBe(true);
  });

  it("ingests parsed COSTS rows into vendor tables", async () => {
    vi.mocked(listComplianceLogFiles).mockResolvedValue({
      data: [{ id: "file-1", end_time: "2026-06-12T00:00:00Z" }],
      has_more: false,
      last_end_time: null,
    });
    vi.mocked(downloadComplianceLogFile).mockResolvedValue(
      `${JSON.stringify({
        event_id: "evt-1",
        type: "COSTS",
        payload: {
          day: "2026-06-11",
          hour: 10,
          identity: { email: "user@wdtablesystems.com" },
          product: "codex",
          measures: {
            billing: [{ sku: "codex", cost: { value: 3, unit: "CREDITS" } }],
          },
        },
      })}\n`,
    );

    const vendorDailyUpsert = vi.fn().mockResolvedValue({});
    const vendorUserUpsert = vi.fn().mockResolvedValue({});
    const snapCreate = vi.fn().mockResolvedValue({});

    const ingestPrisma = {
      programVendorExportSnapshot: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: snapCreate,
      },
      vendorDailySpend: { upsert: vendorDailyUpsert },
      vendorUserDailySpend: { upsert: vendorUserUpsert },
      decision: { create: vi.fn() },
    };

    const out = await syncUnifiedCredits(ingestPrisma as never, {
      actorEmail: "test@wdts.com",
      env: { INTEGRATION_OPENAI_COMPLIANCE: "real", OPENAI_COMPLIANCE_API_KEY: "k", CHATGPT_WORKSPACE_ID: "ws" },
      skipDecision: true,
    });

    expect(out.ok).toBe(true);
    expect(out.recordsParsed).toBe(1);
    expect(vendorDailyUpsert).toHaveBeenCalled();
    expect(vendorUserUpsert).toHaveBeenCalled();
  });
});
