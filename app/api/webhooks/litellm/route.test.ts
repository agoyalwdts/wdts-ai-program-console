/**
 * Contract tests for POST /api/webhooks/litellm (Bearer + Prisma mocked).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "litellm-webhook-test-secret";

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
  process.env.LITELLM_WEBHOOK_SECRET = SECRET;
  mocks.findFirst.mockReset();
  mocks.transaction.mockReset();
  mocks.upsert.mockReset();
  mocks.decisionCreate.mockReset();
  mocks.decisionCreate.mockResolvedValue({});
  mocks.findFirst.mockResolvedValue({ id: "user-litellm-test" });
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
    const tx = { usageRecord: { upsert: mocks.upsert } };
    await fn(tx);
  });
  mocks.upsert.mockResolvedValue({});
});

afterEach(() => {
  delete process.env.LITELLM_WEBHOOK_SECRET;
  delete process.env.LITELLM_DEFAULT_PRODUCT;
});

function makeRequest(body: string, auth?: string | null): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (auth !== null) {
    headers.set("authorization", auth ?? `Bearer ${SECRET}`);
  }
  return new Request("http://localhost/api/webhooks/litellm", {
    method: "POST",
    headers,
    body,
  });
}

async function importRoute() {
  return await import("./route");
}

describe("POST /api/webhooks/litellm", () => {
  it("503s when LITELLM_WEBHOOK_SECRET is unset", async () => {
    delete process.env.LITELLM_WEBHOOK_SECRET;
    const { POST } = await importRoute();
    const res = await POST(makeRequest("[]", null));
    expect(res.status).toBe(503);
  });

  it("401s with missing or wrong Bearer token", async () => {
    const { POST } = await importRoute();
    const body = JSON.stringify([
      {
        id: "chatcmpl-auth-fail",
        model: "gpt-4",
        endTime: "2026-05-02T12:00:00.000Z",
        metadata: { user_email: "x@y.z" },
      },
    ]);
    expect((await POST(makeRequest(body, null))).status).toBe(401);
    expect((await POST(makeRequest(body, "Bearer wrong-token"))).status).toBe(401);
  });

  it("200s on a valid StandardLoggingPayload batch", async () => {
    const { POST } = await importRoute();
    const batch = [
      {
        id: "chatcmpl-litellm-route-1",
        model: "gpt-4",
        prompt_tokens: 3,
        completion_tokens: 2,
        response_cost: 0.001,
        startTime: "2026-05-02T12:00:00.000Z",
        endTime: "2026-05-02T12:00:01.000Z",
        status: "success",
        metadata: { user_email: "agoyal@wdtablesystems.com" },
      },
    ];
    const res = await POST(makeRequest(JSON.stringify(batch)));
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
