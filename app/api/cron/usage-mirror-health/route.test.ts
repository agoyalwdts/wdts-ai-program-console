import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeCronSignature } from "@/lib/cron/auth";

const SECRET = "cron-health-test";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  aggregate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    decision: { findFirst: mocks.findFirst },
    usageRecord: { aggregate: mocks.aggregate },
  },
}));

beforeEach(() => {
  process.env.CRON_SHARED_SECRET = SECRET;
  mocks.findFirst.mockReset();
  mocks.aggregate.mockReset();
  mocks.findFirst.mockResolvedValue({ ts: new Date() });
  mocks.aggregate.mockResolvedValue({ _max: { ts: new Date() } });
});

afterEach(() => {
  delete process.env.CRON_SHARED_SECRET;
});

function makeRequest(body: string, opts?: { signature?: string | null }): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (opts?.signature !== null) {
    headers.set(
      "x-cron-signature",
      opts?.signature ?? computeCronSignature({ rawBody: body, secret: SECRET }),
    );
  }
  return new Request("http://localhost/api/cron/usage-mirror-health", {
    method: "POST",
    headers,
    body,
  });
}

async function importRoute() {
  return await import("./route");
}

describe("POST /api/cron/usage-mirror-health", () => {
  it("503s without CRON_SHARED_SECRET", async () => {
    delete process.env.CRON_SHARED_SECRET;
    const { POST } = await importRoute();
    const res = await POST(makeRequest("{}", { signature: null }));
    expect(res.status).toBe(503);
  });

  it("401s when the signature header is missing", async () => {
    const { POST } = await importRoute();
    const res = await POST(makeRequest("{}", { signature: null }));
    expect(res.status).toBe(401);
  });

  it("200s when batch is fresh", async () => {
    const { POST } = await importRoute();
    const body = "{}";
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean };
    expect(j.ok).toBe(true);
  });
});
