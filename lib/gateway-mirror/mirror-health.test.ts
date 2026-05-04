import { describe, expect, it, vi } from "vitest";
import { evaluateGatewayMirrorHealth } from "./mirror-health";

describe("evaluateGatewayMirrorHealth", () => {
  it("fails when requireBatch and no batch decision", async () => {
    const prisma = {
      decision: { findFirst: vi.fn().mockResolvedValue(null) },
      usageRecord: { aggregate: vi.fn().mockResolvedValue({ _max: { ts: null } }) },
    } as never;
    const r = await evaluateGatewayMirrorHealth(prisma, {
      maxStaleMs: 60_000,
      requireBatch: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/no USAGE_INGEST_BATCH/);
  });

  it("passes when batch is recent", async () => {
    const recent = new Date();
    const prisma = {
      decision: { findFirst: vi.fn().mockResolvedValue({ ts: recent }) },
      usageRecord: { aggregate: vi.fn().mockResolvedValue({ _max: { ts: recent } }) },
    } as never;
    const r = await evaluateGatewayMirrorHealth(prisma, {
      maxStaleMs: 86_400_000,
      requireBatch: false,
    });
    expect(r.ok).toBe(true);
  });
});
