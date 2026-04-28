/**
 * Webhook receiver unit test. Prisma is mocked so this test doesn't
 * collide with parallel-worker DB tests; the actual DB-write contract
 * is covered indirectly by the seed + the migration smoke. The
 * integration-level write path will be exercised end-to-end by
 * Playwright once it lands (scoping §9.2).
 */

import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "wh-test-secret";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  decisionCreate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.findUnique },
    decision: { create: mocks.decisionCreate },
  },
}));

beforeEach(() => {
  process.env.DEEL_WEBHOOK_SECRET = SECRET;
  mocks.findUnique.mockReset();
  mocks.decisionCreate.mockReset();
  mocks.decisionCreate.mockResolvedValue({});
});

afterEach(() => {
  delete process.env.DEEL_WEBHOOK_SECRET;
});

function signed(body: string): string {
  return `sha256=${createHmac("sha256", SECRET).update(body, "utf-8").digest("hex")}`;
}

function makeRequest(body: string, opts?: { signature?: string | null }): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (opts?.signature !== null) {
    headers.set("x-deel-signature", opts?.signature ?? signed(body));
  }
  return new Request("http://localhost/api/webhooks/deel", {
    method: "POST",
    headers,
    body,
  });
}

async function importRoute() {
  return await import("./route");
}

describe("POST /api/webhooks/deel", () => {
  it("503s when DEEL_WEBHOOK_SECRET is unset", async () => {
    delete process.env.DEEL_WEBHOOK_SECRET;
    const { POST } = await importRoute();
    const res = await POST(makeRequest("{}", { signature: null }));
    expect(res.status).toBe(503);
    expect(mocks.decisionCreate).not.toHaveBeenCalled();
  });

  it("401s when the signature header is missing", async () => {
    const { POST } = await importRoute();
    const res = await POST(makeRequest('{"x":1}', { signature: null }));
    expect(res.status).toBe(401);
  });

  it("401s on a wrong signature", async () => {
    const { POST } = await importRoute();
    const res = await POST(
      makeRequest('{"x":1}', { signature: "sha256=" + "00".repeat(32) }),
    );
    expect(res.status).toBe(401);
  });

  it("400s on malformed JSON", async () => {
    const body = "{not json";
    const { POST } = await importRoute();
    const res = await POST(makeRequest(body, { signature: signed(body) }));
    expect(res.status).toBe(400);
  });

  it("202s on unrecognised envelope (no Decision row)", async () => {
    const body = JSON.stringify({ event_type: "contract.signed", data: { email: "x@w.com" } });
    const { POST } = await importRoute();
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(202);
    expect(mocks.decisionCreate).not.toHaveBeenCalled();
  });

  it("records a Decision on a valid employee.updated event (existing user)", async () => {
    mocks.findUnique.mockResolvedValueOnce({ id: "user-uuid-1" });
    const body = JSON.stringify({
      event_type: "employee.updated",
      data: {
        email: "alice@wdts.com",
        full_name: "Alice",
        seniority: "promoted",
        manager_email: "boss@wdts.com",
        country: "AU",
        status: "active",
      },
    });
    const { POST } = await importRoute();
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    expect(mocks.decisionCreate).toHaveBeenCalledTimes(1);
    const arg = mocks.decisionCreate.mock.calls[0][0];
    expect(arg.data.type).toBe("METHODOLOGY_CHANGE");
    expect(arg.data.subjectUserId).toBe("user-uuid-1");
    expect(arg.data.actorEmail).toBe("deel-webhook@dashboard");
    expect(arg.data.justification).toContain("alice@wdts.com");
    expect(arg.data.afterState).toContain("EMPLOYEE_UPDATED");
    expect(arg.data.afterState).toContain("promoted");
  });

  it("records a Decision with subjectUserId=undefined for a brand-new hire", async () => {
    mocks.findUnique.mockResolvedValueOnce(null);
    const body = JSON.stringify({
      event_type: "employee.hired",
      data: {
        email: "newhire@wdts.com",
        full_name: "Brand New",
        seniority: "intern",
        manager_email: "boss@wdts.com",
        country: "AU",
        status: "active",
      },
    });
    const { POST } = await importRoute();
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    const arg = mocks.decisionCreate.mock.calls[0][0];
    expect(arg.data.subjectUserId).toBeUndefined();
    expect(arg.data.justification).toContain("EMPLOYEE_HIRED");
  });
});
