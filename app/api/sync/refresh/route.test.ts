import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  refreshDashboardMirrors: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireUser: mocks.requireUser,
}));

vi.mock("@/lib/sync", () => ({
  refreshDashboardMirrors: mocks.refreshDashboardMirrors,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));

beforeEach(() => {
  mocks.requireUser.mockReset();
  mocks.refreshDashboardMirrors.mockReset();
  mocks.requireUser.mockResolvedValue({ email: "op@wdts.com" });
  mocks.refreshDashboardMirrors.mockResolvedValue({
    trigger: "manual_refresh",
    ran: 2,
    skipped: 1,
    failed: 0,
    timedOut: 0,
    jobs: [],
    oldestHotSuccessAt: new Date(),
  });
});

describe("POST /api/sync/refresh", () => {
  it("requires session and runs orchestrator", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/sync/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force: true }),
      }),
    );
    expect(res.status).toBe(200);
    expect(mocks.refreshDashboardMirrors).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        trigger: "manual_refresh",
        actorEmail: "op@wdts.com",
        force: true,
        maxWaitMs: 60_000,
      }),
    );
  });
});
