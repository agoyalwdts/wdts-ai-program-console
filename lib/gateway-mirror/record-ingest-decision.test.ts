import { describe, expect, it, vi } from "vitest";
import { recordUsageIngestBatchDecision, GATEWAY_MIRROR_ACTOR_EMAIL } from "./record-ingest-decision";

describe("recordUsageIngestBatchDecision", () => {
  it("no-ops when upserted is 0", async () => {
    const create = vi.fn();
    const prisma = { decision: { create } } as never;
    await recordUsageIngestBatchDecision(prisma, {
      source: "litellm",
      upserted: 0,
      accepted: 1,
      rejected: [],
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("creates USAGE_INGEST_BATCH when upserted > 0", async () => {
    const create = vi.fn().mockResolvedValue({});
    const prisma = { decision: { create } } as never;
    await recordUsageIngestBatchDecision(prisma, {
      source: "generic_usage_ingest",
      upserted: 3,
      accepted: 3,
      rejected: [{ index: 0, reason: "skip" }],
    });
    expect(create).toHaveBeenCalledTimes(1);
    const arg = create.mock.calls[0]![0] as { data: { type: string; actorEmail: string } };
    expect(arg.data.type).toBe("USAGE_INGEST_BATCH");
    expect(arg.data.actorEmail).toBe(GATEWAY_MIRROR_ACTOR_EMAIL);
  });
});
