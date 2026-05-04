import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseUsageIngestBody, validateUsageIngestEvents } from "./validate";
import { USAGE_INGEST_MAX_EVENTS } from "./types";

const prismaMock = {
  user: {
    findFirst: vi.fn(),
  },
};

describe("parseUsageIngestBody", () => {
  it("accepts a well-formed payload", () => {
    const r = parseUsageIngestBody({ events: [{ sourceEventId: "a".repeat(8) }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.events).toHaveLength(1);
  });

  it("rejects missing events", () => {
    const r = parseUsageIngestBody({});
    expect(r.ok).toBe(false);
  });

  it("rejects oversized batches", () => {
    const events = Array.from({ length: USAGE_INGEST_MAX_EVENTS + 1 }, () => ({}));
    const r = parseUsageIngestBody({ events });
    expect(r.ok).toBe(false);
  });
});

describe("validateUsageIngestEvents", () => {
  beforeEach(() => {
    prismaMock.user.findFirst.mockReset();
  });

  it("resolves email and returns a valid row", async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce({ id: "user-1" });

    const { valid, rejected } = await validateUsageIngestEvents(
      prismaMock as never,
      [
        {
          sourceEventId: "evt-test-001",
          userEmail: "Owner@Example.com",
          product: "CHATGPT",
          model: "gpt-4",
          tokensIn: 10,
          tokensOut: 5,
          costUsd: 0.01,
          decision: "ALLOWED",
          region: "in",
          ts: "2026-05-01T12:00:00.000Z",
          dlpLayersHit: [],
        },
      ],
    );

    expect(rejected).toHaveLength(0);
    expect(valid).toHaveLength(1);
    expect(valid[0]!.userId).toBe("user-1");
    expect(valid[0]!.sourceEventId).toBe("evt-test-001");
    expect(prismaMock.user.findFirst).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown email", async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce(null);

    const { valid, rejected } = await validateUsageIngestEvents(
      prismaMock as never,
      [
        {
          sourceEventId: "evt-unknown-user",
          userEmail: "nobody@example.com",
          product: "CHATGPT",
          model: "gpt-4",
          region: "in",
          ts: "2026-05-01T12:00:00.000Z",
        },
      ],
    );

    expect(valid).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toContain("no User row");
  });
});
