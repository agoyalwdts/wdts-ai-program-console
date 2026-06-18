import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeCronSignature } from "@/lib/cron/auth";

const SECRET = "cron-test-secret";

const mocks = vi.hoisted(() => ({
  processExpired: vi.fn(),
}));

vi.mock("@/lib/reclamation/reclamation-events", () => ({
  processExpiredReclamationDisputeWindows: mocks.processExpired,
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

beforeEach(() => {
  process.env.CRON_SHARED_SECRET = SECRET;
  mocks.processExpired.mockReset();
  mocks.processExpired.mockResolvedValue({
    scanned: 1,
    expired: 1,
    errors: [],
    eventIds: ["rec-1"],
  });
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
  return new Request("http://localhost/api/cron/reconcile-reclamations", {
    method: "POST",
    headers,
    body,
  });
}

describe("POST /api/cron/reconcile-reclamations", () => {
  it("503s when secret unset", async () => {
    delete process.env.CRON_SHARED_SECRET;
    const { POST } = await import("./route");
    const res = await POST(makeRequest("{}", { signature: null }));
    expect(res.status).toBe(503);
  });

  it("200s with summary on valid signature", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean; summary: { expired: number } };
    expect(j.ok).toBe(true);
    expect(j.summary.expired).toBe(1);
  });
});
