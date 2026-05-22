import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  runGuardrailMonitor: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requirePermission: mocks.requirePermission,
}));

vi.mock("@/lib/guardrails/monitor", () => ({
  runGuardrailMonitor: mocks.runGuardrailMonitor,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));

beforeEach(() => {
  mocks.requirePermission.mockReset();
  mocks.runGuardrailMonitor.mockReset();
  mocks.requirePermission.mockResolvedValue({ email: "admin@wdts.com" });
  mocks.runGuardrailMonitor.mockResolvedValue({
    scannedUsageRows: 0,
    scannedCursorEvents: 5,
    cursorRowsInWindow: 3,
    cursorFeedActive: true,
    cursorFeedSkipReason: null,
    scannedDecisions: 0,
    candidates: 1,
    inserted: 1,
    emailed: 0,
    emailError: null,
    userEmailed: 0,
    userEmailAttempted: 0,
    userEmailError: null,
  });
});

async function importRoute() {
  return await import("./route");
}

describe("POST /api/admin/run-guardrail-monitor", () => {
  it("runs monitor with default window and actor email", async () => {
    const { POST } = await importRoute();
    const res = await POST(
      new Request("http://localhost/api/admin/run-guardrail-monitor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean; summary: { inserted: number } };
    expect(j.ok).toBe(true);
    expect(j.summary.inserted).toBe(1);
    expect(mocks.runGuardrailMonitor).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ windowHours: 2, actorEmail: "admin@wdts.com" }),
    );
  });

  it("clamps windowHours", async () => {
    const { POST } = await importRoute();
    await POST(
      new Request("http://localhost/api/admin/run-guardrail-monitor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ windowHours: 999 }),
      }),
    );
    expect(mocks.runGuardrailMonitor).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ windowHours: 168 }),
    );
  });
});
