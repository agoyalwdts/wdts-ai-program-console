import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  requestCodexTierMove: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
  userHasPermission: () => true,
}));

vi.mock("@/lib/decisions/codex-tier-move", () => ({
  requestCodexTierMove: mocks.requestCodexTierMove,
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

beforeEach(() => {
  mocks.getCurrentUser.mockReset();
  mocks.requestCodexTierMove.mockReset();
  mocks.getCurrentUser.mockResolvedValue({ email: "admin@test.local", disabled: false, permissions: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/tier-moves/codex", () => {
  it("400s on invalid body", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "u1" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns PR details on success", async () => {
    mocks.requestCodexTierMove.mockResolvedValue({
      ok: true,
      decisionId: "dec-1",
      decisionType: "TIER_PROMOTION",
      fromSubTier: "DISCOVERY",
      toSubTier: "LIGHT",
      prUrl: "https://example.test/pr/1",
      prNumber: 1,
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "u1",
          direction: "promote",
          justification: "Promotion per ladder queue.",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean; prUrl: string };
    expect(j.ok).toBe(true);
    expect(j.prUrl).toContain("/pr/1");
  });
});
