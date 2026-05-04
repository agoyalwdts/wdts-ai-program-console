/**
 * Contract tests for POST /api/webhooks/usage-ingest (HMAC + Prisma mocked).
 */

import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "usage-ingest-test-secret";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  upsert: vi.fn(),
  transaction: vi.fn(),
  decisionCreate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findFirst: mocks.findFirst },
    $transaction: mocks.transaction,
    decision: { create: mocks.decisionCreate },
  },
}));

beforeEach(() => {
  process.env.USAGE_INGEST_HMAC_SECRET = SECRET;
  mocks.findFirst.mockReset();
  mocks.transaction.mockReset();
  mocks.upsert.mockReset();
  mocks.decisionCreate.mockReset();
  mocks.decisionCreate.mockResolvedValue({});
  mocks.findFirst.mockResolvedValue({ id: "seed-user-id" });
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
    const tx = { usageRecord: { upsert: mocks.upsert } };
    await fn(tx);
  });
  mocks.upsert.mockResolvedValue({});
});

afterEach(() => {
  delete process.env.USAGE_INGEST_HMAC_SECRET;
});

function sign(body: string): string {
  return `sha256=${createHmac("sha256", SECRET).update(body, "utf-8").digest("hex")}`;
}

function makeRequest(body: string, opts?: { signature?: string | null }): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (opts?.signature !== null) {
    headers.set("x-usage-ingest-signature", opts?.signature ?? sign(body));
  }
  return new Request("http://localhost/api/webhooks/usage-ingest", {
    method: "POST",
    headers,
    body,
  });
}

async function importRoute() {
  return await import("./route");
}

describe("POST /api/webhooks/usage-ingest", () => {
  it("503s when USAGE_INGEST_HMAC_SECRET is unset", async () => {
    delete process.env.USAGE_INGEST_HMAC_SECRET;
    const { POST } = await importRoute();
    const res = await POST(makeRequest("{}", { signature: null }));
    expect(res.status).toBe(503);
  });

  it("401s when signature header is missing", async () => {
    const { POST } = await importRoute();
    const res = await POST(makeRequest("{}", { signature: null }));
    expect(res.status).toBe(401);
  });

  it("400s on malformed JSON", async () => {
    const { POST } = await importRoute();
    const res = await POST(makeRequest("{", { signature: sign("{") }));
    expect(res.status).toBe(400);
  });

  it("422s when every event is invalid", async () => {
    const { POST } = await importRoute();
    const body = JSON.stringify({ events: [{ sourceEventId: "short" }] });
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(422);
  });

  it("200s and upserts on a valid event", async () => {
    const { POST } = await importRoute();
    const payload = {
      events: [
        {
          sourceEventId: "gateway-evt-0001",
          userEmail: "any@seeded.user",
          product: "CHATGPT",
          model: "gpt-4",
          region: "in",
          ts: "2026-05-02T00:00:00.000Z",
          decision: "ALLOWED",
        },
      ],
    };
    const body = JSON.stringify(payload);
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; upserted: number };
    expect(json.ok).toBe(true);
    expect(json.upserted).toBe(1);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.decisionCreate).toHaveBeenCalledTimes(1);
  });

  it("405 GET — POST only (browser probe)", async () => {
    const { GET } = await importRoute();
    const res = await GET();
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });
});
