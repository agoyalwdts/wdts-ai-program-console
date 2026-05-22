import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  loadGuardrailAlertForAction: vi.fn(),
  requestSeatRemovalFromAlert: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requirePermission: mocks.requirePermission,
}));

vi.mock("@/lib/guardrails/alert-action-helpers", () => ({
  loadGuardrailAlertForAction: mocks.loadGuardrailAlertForAction,
  requestSeatRemovalFromAlert: mocks.requestSeatRemovalFromAlert,
}));

beforeEach(() => {
  mocks.requirePermission.mockReset();
  mocks.loadGuardrailAlertForAction.mockReset();
  mocks.requestSeatRemovalFromAlert.mockReset();
  mocks.requirePermission.mockResolvedValue({ email: "finops@test.local" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/guardrail-policy-alerts/:id/request-seat-removal", () => {
  it("404s when alert missing", async () => {
    mocks.loadGuardrailAlertForAction.mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(new Request("http://localhost", { method: "POST" }) as never, {
      params: Promise.resolve({ id: "missing" }),
    });
    expect(res.status).toBe(404);
  });

  it("200s with decision id", async () => {
    mocks.loadGuardrailAlertForAction.mockResolvedValue({ id: "a1" });
    mocks.requestSeatRemovalFromAlert.mockResolvedValue({
      ok: true,
      decisionId: "dec-99",
      decisionType: "CURSOR_SEAT_RECLAIM",
    });
    const { POST } = await import("./route");
    const res = await POST(new Request("http://localhost", { method: "POST" }) as never, {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean; decisionId: string };
    expect(j.ok).toBe(true);
    expect(j.decisionId).toBe("dec-99");
  });
});
