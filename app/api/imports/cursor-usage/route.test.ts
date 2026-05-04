/**
 * Contract tests for POST /api/imports/cursor-usage (auth + Prisma + email mocked).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  decisionCreate: vi.fn(),
  createMany: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
  sendDigest: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requirePermission: mocks.requirePermission,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    decision: { create: mocks.decisionCreate },
    cursorUsagePrudenceAlert: {
      createMany: mocks.createMany,
      findMany: mocks.findMany,
      updateMany: mocks.updateMany,
    },
  },
}));

vi.mock("@/lib/notify/cursor-prudence-email", () => ({
  sendCursorPrudenceDigest: mocks.sendDigest,
}));

const SAMPLE_HEADER = `Date,User,Team,Kind,Model,Max Mode,Input (w/ cache write),Input (no cache),Cache Read,Output Tokens,Total Tokens,Cost`;

beforeEach(() => {
  mocks.requirePermission.mockReset();
  mocks.decisionCreate.mockReset();
  mocks.createMany.mockReset();
  mocks.findMany.mockReset();
  mocks.updateMany.mockReset();
  mocks.sendDigest.mockReset();
  mocks.requirePermission.mockResolvedValue({ email: "finops@test.local" });
  mocks.decisionCreate.mockResolvedValue({});
  mocks.createMany.mockResolvedValue({ count: 1 });
  mocks.findMany.mockResolvedValue([]);
  mocks.sendDigest.mockResolvedValue({ ok: false, skipped: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

async function importRoute() {
  return await import("./route");
}

describe("POST /api/imports/cursor-usage", () => {
  it("415s for unsupported content-type", async () => {
    const { POST } = await importRoute();
    const req = new Request("http://localhost/api/imports/cursor-usage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const res = await POST(req as never);
    expect(res.status).toBe(415);
  });

  it("dryRun=1 returns sample without writing", async () => {
    const csv = `${SAMPLE_HEADER}
2026-04-30T12:00:00.000Z,pmishra@wdtablesystems.com,,Included,claude-4.6-opus-max-thinking-fast,Yes,160882,7025,2117021,13340,2298268,14.79`;
    const { POST } = await importRoute();
    const req = new Request("http://localhost/api/imports/cursor-usage?dryRun=1", {
      method: "POST",
      headers: { "content-type": "text/csv" },
      body: csv,
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean; dryRun?: boolean; alertsWouldCreate?: number };
    expect(j.ok).toBe(true);
    expect(j.dryRun).toBe(true);
    expect(j.alertsWouldCreate).toBeGreaterThan(0);
    expect(mocks.decisionCreate).not.toHaveBeenCalled();
    expect(mocks.createMany).not.toHaveBeenCalled();
  });

  it("inserts alerts and records Decision when not dry run", async () => {
    const csv = `${SAMPLE_HEADER}
2026-04-30T12:00:00.000Z,pmishra@wdtablesystems.com,,Included,claude-4.6-opus-max-thinking-fast,Yes,160882,7025,2117021,13340,2298268,14.79`;
    const { POST } = await importRoute();
    const req = new Request("http://localhost/api/imports/cursor-usage", {
      method: "POST",
      headers: { "content-type": "text/csv" },
      body: csv,
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean; alertsInserted?: number };
    expect(j.ok).toBe(true);
    expect(mocks.createMany).toHaveBeenCalled();
    expect(mocks.decisionCreate).toHaveBeenCalled();
  });
});
