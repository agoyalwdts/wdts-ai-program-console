/**
 * PATCH /api/cursor-prudence-alerts/:id — auth + Prisma mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  updateMany: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requirePermission: mocks.requirePermission,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cursorUsagePrudenceAlert: {
      updateMany: mocks.updateMany,
      findUnique: mocks.findUnique,
    },
  },
}));

beforeEach(() => {
  mocks.requirePermission.mockReset();
  mocks.updateMany.mockReset();
  mocks.findUnique.mockReset();
  mocks.requirePermission.mockResolvedValue({ email: "finops@test.local" });
});

afterEach(() => {
  vi.clearAllMocks();
});

function patchReq(body: unknown, id = "alert-1"): Request {
  return new Request(`http://localhost/api/cursor-prudence-alerts/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function importRoute() {
  return await import("./route");
}

describe("PATCH /api/cursor-prudence-alerts/:id", () => {
  it("400s when body is not valid JSON", async () => {
    const { PATCH } = await importRoute();
    const req = new Request("http://localhost/api/cursor-prudence-alerts/x", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    const res = await PATCH(req as never, { params: Promise.resolve({ id: "x" }) });
    expect(res.status).toBe(400);
  });

  it("400s when acknowledged is not true", async () => {
    const { PATCH } = await importRoute();
    const res = await PATCH(patchReq({ acknowledged: false }) as never, {
      params: Promise.resolve({ id: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("200s and sets acknowledged when updateMany matches", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    const { PATCH } = await importRoute();
    const res = await PATCH(patchReq({ acknowledged: true }) as never, {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean; acknowledgedAt?: string };
    expect(j.ok).toBe(true);
    expect(j.acknowledgedAt).toMatch(/^\d{4}-/);
    expect(mocks.updateMany).toHaveBeenCalled();
  });

  it("404s when row does not exist", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockResolvedValue(null);
    const { PATCH } = await importRoute();
    const res = await PATCH(patchReq({ acknowledged: true }) as never, {
      params: Promise.resolve({ id: "missing" }),
    });
    expect(res.status).toBe(404);
  });
});
