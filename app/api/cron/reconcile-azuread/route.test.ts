/**
 * Cron route unit test. The reconciler itself is mocked so this is a
 * pure auth/dispatch test — it covers the closed-by-default contract
 * (missing secret → 503, wrong signature → 401, valid signature →
 * delegate to the reconciler) without spinning up a DB.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeCronSignature } from "@/lib/cron/auth";

const SECRET = "cron-test-secret";

const mocks = vi.hoisted(() => ({
  reconcile: vi.fn(),
}));

vi.mock("@/prisma/scripts/reconcile-azuread", () => ({
  reconcileAzureAD: mocks.reconcile,
}));

beforeEach(() => {
  process.env.CRON_SHARED_SECRET = SECRET;
  mocks.reconcile.mockReset();
  mocks.reconcile.mockResolvedValue({
    graphUserCount: 0,
    graphSkippedNoEmail: 0,
    prismaCreated: 0,
    prismaUpdated: 0,
    prismaSuspended: 0,
    prismaSkippedClean: 0,
    managerEdgesLinked: 0,
    managerEdgesCleared: 0,
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
  return new Request("http://localhost/api/cron/reconcile-azuread", {
    method: "POST",
    headers,
    body,
  });
}

async function importRoute() {
  return await import("./route");
}

describe("POST /api/cron/reconcile-azuread", () => {
  it("503s when CRON_SHARED_SECRET is unset (fail-closed)", async () => {
    delete process.env.CRON_SHARED_SECRET;
    const { POST } = await importRoute();
    const res = await POST(makeRequest("{}", { signature: null }));
    expect(res.status).toBe(503);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("401s when the signature header is missing", async () => {
    const { POST } = await importRoute();
    const res = await POST(makeRequest("{}", { signature: null }));
    expect(res.status).toBe(401);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("401s on a wrong signature", async () => {
    const { POST } = await importRoute();
    const res = await POST(
      makeRequest("{}", { signature: "sha256=" + "0".repeat(64) }),
    );
    expect(res.status).toBe(401);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("401s when the body is tampered after signing (signature is body-bound)", async () => {
    const validSig = computeCronSignature({ rawBody: "{}", secret: SECRET });
    const tampered = '{"dryRun":true}';
    const { POST } = await importRoute();
    const res = await POST(makeRequest(tampered, { signature: validSig }));
    expect(res.status).toBe(401);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("400s on malformed JSON body (with valid signature)", async () => {
    const body = "{not json";
    const { POST } = await importRoute();
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(400);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("200s on a valid signed empty body and runs the reconciler in apply mode", async () => {
    const { POST } = await importRoute();
    const res = await POST(makeRequest(""));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.dryRun).toBe(false);
    expect(mocks.reconcile).toHaveBeenCalledWith({ dryRun: false });
  });

  it("200s on a valid signed {} body and runs the reconciler in apply mode", async () => {
    const { POST } = await importRoute();
    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.dryRun).toBe(false);
    expect(mocks.reconcile).toHaveBeenCalledWith({ dryRun: false });
  });

  it("200s on a valid signed {dryRun:true} body and forwards dryRun to the reconciler", async () => {
    const { POST } = await importRoute();
    const res = await POST(makeRequest('{"dryRun":true}'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.dryRun).toBe(true);
    expect(mocks.reconcile).toHaveBeenCalledWith({ dryRun: true });
  });

  it("propagates the reconciler summary verbatim in the response", async () => {
    mocks.reconcile.mockResolvedValueOnce({
      graphUserCount: 42,
      graphSkippedNoEmail: 1,
      prismaCreated: 3,
      prismaUpdated: 4,
      prismaSuspended: 1,
      prismaSkippedClean: 33,
      managerEdgesLinked: 2,
      managerEdgesCleared: 0,
    });
    const { POST } = await importRoute();
    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.summary.graphUserCount).toBe(42);
    expect(json.summary.prismaCreated).toBe(3);
    expect(json.summary.managerEdgesLinked).toBe(2);
  });

  it("405s on GET", async () => {
    const { GET } = await importRoute();
    const res = await GET();
    expect(res.status).toBe(405);
  });
});
