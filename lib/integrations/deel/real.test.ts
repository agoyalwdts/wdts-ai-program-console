import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrationError } from "../errors";
import { makeRealDeelClient } from "./real";

type Recorded = { url: string; method: string; headers: Record<string, string> };

function makeMockFetch(
  responder: (req: Recorded) => { status: number; body?: unknown },
): { fetchImpl: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const req: Recorded = { url, method: init?.method ?? "GET", headers };
    calls.push(req);
    const r = responder(req);
    return new Response(JSON.stringify(r.body ?? {}), {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const ENV = { DEEL_API_TOKEN: "deel-api-test-token" };

describe("makeRealDeelClient", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("real fetch invoked — test forgot to inject fetchImpl");
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("listEmployees maps Deel Person to DeelEmployee", async () => {
    const { fetchImpl, calls } = makeMockFetch(() => ({
      status: 200,
      body: {
        data: [
          {
            id: "p_1",
            email: "Alice@WDTS.com",
            full_name: "Alice Smith",
            seniority: "sw_engineer_senior",
            manager_email: "boss@wdts.com",
            country: "AU",
            status: "active",
          },
          {
            id: "p_2",
            work_email: "bob@wdts.com",
            first_name: "Bob",
            last_name: "Lee",
            job_title: "Designer",
            manager: { email: null },
            working_location: { country: "GB" },
            status: "terminated",
          },
        ],
      },
    }));
    const out = await makeRealDeelClient({ fetchImpl, env: ENV }).listEmployees();
    expect(out).toEqual([
      {
        email: "alice@wdts.com",
        displayName: "Alice Smith",
        roleTag: "sw_engineer_senior",
        managerEmail: "boss@wdts.com",
        region: "AU",
        status: "ACTIVE",
      },
      {
        email: "bob@wdts.com",
        displayName: "Bob Lee",
        roleTag: "Designer",
        managerEmail: null,
        region: "GB",
        status: "TERMINATED",
      },
    ]);
    expect(calls[0].headers["authorization"]).toBe("Bearer deel-api-test-token");
    expect(calls[0].url).toContain("/people?limit=100");
  });

  it("paginates via meta.cursor.next", async () => {
    let i = 0;
    const { fetchImpl, calls } = makeMockFetch(() => {
      const pages = [
        {
          data: [
            { id: "p1", email: "a@w.com", status: "active" },
          ],
          meta: { cursor: { next: "https://api.letsdeel.com/rest/v2/people?cursor=abc" } },
        },
        {
          data: [{ id: "p2", email: "b@w.com", status: "active" }],
          meta: {},
        },
      ];
      return { status: 200, body: pages[i++] };
    });
    const out = await makeRealDeelClient({ fetchImpl, env: ENV }).listEmployees();
    expect(out.map((e) => e.email)).toEqual(["a@w.com", "b@w.com"]);
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain("cursor=abc");
  });

  it("getEmployeeByEmail returns null on empty data", async () => {
    const { fetchImpl } = makeMockFetch(() => ({ status: 200, body: { data: [] } }));
    const out = await makeRealDeelClient({ fetchImpl, env: ENV }).getEmployeeByEmail(
      "missing@wdts.com",
    );
    expect(out).toBeNull();
  });

  it("getEmployeeByEmail short-circuits on empty argument", async () => {
    const { fetchImpl, calls } = makeMockFetch(() => ({ status: 500 }));
    const out = await makeRealDeelClient({ fetchImpl, env: ENV }).getEmployeeByEmail("");
    expect(out).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("throws IntegrationError without DEEL_API_TOKEN", async () => {
    const c = makeRealDeelClient({
      fetchImpl: makeMockFetch(() => ({ status: 200 })).fetchImpl,
      env: {},
    });
    await expect(c.listEmployees()).rejects.toThrow(IntegrationError);
  });

  it("propagates non-2xx as IntegrationError", async () => {
    const { fetchImpl } = makeMockFetch(() => ({
      status: 401,
      body: { error: "invalid token" },
    }));
    await expect(
      makeRealDeelClient({ fetchImpl, env: ENV }).listEmployees(),
    ).rejects.toThrow(IntegrationError);
  });
});
