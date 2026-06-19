import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  syncCursor: vi.fn(),
  syncCodex: vi.fn(),
  syncWorkspace: vi.fn(),
  syncUnified: vi.fn(),
  syncOpenai: vi.fn(),
}));

vi.mock("@/lib/vendor-spend/sync-cursor-vendor-daily", () => ({
  syncCursorVendorDailySpendWindow: mocks.syncCursor,
}));

vi.mock("@/lib/vendor-spend/sync-codex-enterprise-daily", () => ({
  syncCodexEnterpriseAnalyticsDaily: mocks.syncCodex,
}));

vi.mock("@/lib/integrations/workspace-analytics", () => ({
  syncWorkspaceAnalytics: mocks.syncWorkspace,
}));

vi.mock("@/lib/integrations/unified-credits", () => ({
  syncUnifiedCredits: mocks.syncUnified,
}));

vi.mock("@/lib/vendor-spend/sync-openai-vendor-daily", () => ({
  syncOpenAiVendorDailySpendWindow: mocks.syncOpenai,
}));

function makePrisma(store = new Map<string, unknown>()): PrismaClient {
  return {
    integrationSyncState: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        (store.get(where.key) as object | undefined) ?? null,
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { key: string };
        create: object;
        update: object;
      }) => {
        const prev = (store.get(where.key) as object | undefined) ?? {};
        const next = { ...prev, ...create, ...update, key: where.key };
        store.set(where.key, next);
        return next;
      },
    },
  } as unknown as PrismaClient;
}

describe("refreshDashboardMirrors", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.INTEGRATION_CURSOR = "real";
    process.env.INTEGRATION_CODEX_ENTERPRISE_ANALYTICS = "synthetic";
    process.env.INTEGRATION_OPENAI_COMPLIANCE = "synthetic";
    process.env.INTEGRATION_OPENAI = "synthetic";
    mocks.syncCursor.mockResolvedValue({ daysUpserted: 2, userDayRowsUpserted: 5 });
  });

  it("skips fresh jobs on page_load", async () => {
    const store = new Map<string, unknown>();
    store.set("cursor_vendor_spend", {
      key: "cursor_vendor_spend",
      lastSuccessAt: new Date(),
      lastAttemptAt: new Date(),
    });
    const prisma = makePrisma(store);
    const { refreshDashboardMirrors } = await import("./orchestrator");
    const result = await refreshDashboardMirrors(prisma, {
      trigger: "page_load",
      actorEmail: "u@wdts.com",
      tiers: ["hot"],
    });
    expect(result.skipped).toBeGreaterThan(0);
    expect(mocks.syncCursor).not.toHaveBeenCalled();
  });

  it("runs stale cursor job and records success", async () => {
    const prisma = makePrisma(new Map());
    const { refreshDashboardMirrors } = await import("./orchestrator");
    const result = await refreshDashboardMirrors(prisma, {
      trigger: "page_load",
      actorEmail: "u@wdts.com",
      tiers: ["hot"],
      force: true,
    });
    expect(mocks.syncCursor).toHaveBeenCalled();
    const cursorJob = result.jobs.find((j) => j.key === "cursor_vendor_spend");
    expect(cursorJob?.ok).toBe(true);
    const row = await prisma.integrationSyncState.findUnique({
      where: { key: "cursor_vendor_spend" },
    });
    expect(row?.lastSuccessAt).toBeTruthy();
  });
});
