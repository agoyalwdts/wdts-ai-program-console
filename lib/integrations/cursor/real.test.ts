import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrationError } from "../errors";
import { makeRealCursorClient } from "./real";

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

const ENV = {
  CURSOR_SCIM_BASE_URL: "https://cursor.com/api/scim/v2",
  CURSOR_ADMIN_TOKEN: "scim-test-token",
};

describe("makeRealCursorClient.listSeats", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("real fetch invoked — test forgot to inject fetchImpl");
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("hits the SCIM /Users endpoint with bearer auth + scim+json accept", async () => {
    const { fetchImpl, calls } = makeMockFetch(() => ({
      status: 200,
      body: {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        totalResults: 1,
        itemsPerPage: 100,
        startIndex: 1,
        Resources: [
          {
            id: "u-1",
            userName: "alice@wdts.com",
            displayName: "Alice",
            active: true,
            emails: [{ value: "alice@wdts.com", primary: true }],
          },
        ],
      },
    }));
    const seats = await makeRealCursorClient({ fetchImpl, env: ENV }).listSeats();
    expect(seats).toEqual([
      {
        userId: "u-1",
        email: "alice@wdts.com",
        displayName: "Alice",
        subTier: "STANDARD",
        lastActivityTs: null,
        idleDays: null,
        mtdSpendUsd: 0,
      },
    ]);
    expect(calls[0].url).toBe(
      "https://cursor.com/api/scim/v2/Users?startIndex=1&count=100",
    );
    expect(calls[0].headers["authorization"]).toBe("Bearer scim-test-token");
    expect(calls[0].headers["accept"]).toBe("application/scim+json");
  });

  it("filters out users with active=false", async () => {
    const { fetchImpl } = makeMockFetch(() => ({
      status: 200,
      body: {
        schemas: [],
        totalResults: 2,
        itemsPerPage: 100,
        startIndex: 1,
        Resources: [
          { id: "u-1", userName: "active@w.com", active: true },
          { id: "u-2", userName: "deactivated@w.com", active: false },
        ],
      },
    }));
    const seats = await makeRealCursorClient({ fetchImpl, env: ENV }).listSeats();
    expect(seats.map((s) => s.userId)).toEqual(["u-1"]);
  });

  it("paginates via startIndex when totalResults > count", async () => {
    let i = 0;
    const { fetchImpl, calls } = makeMockFetch(() => {
      const pages = [
        {
          schemas: [],
          totalResults: 250,
          itemsPerPage: 100,
          startIndex: 1,
          Resources: Array.from({ length: 100 }, (_, n) => ({
            id: `p1-${n}`,
            userName: `p1-${n}@w.com`,
            active: true,
          })),
        },
        {
          schemas: [],
          totalResults: 250,
          itemsPerPage: 100,
          startIndex: 101,
          Resources: Array.from({ length: 100 }, (_, n) => ({
            id: `p2-${n}`,
            userName: `p2-${n}@w.com`,
            active: true,
          })),
        },
        {
          schemas: [],
          totalResults: 250,
          itemsPerPage: 100,
          startIndex: 201,
          Resources: Array.from({ length: 50 }, (_, n) => ({
            id: `p3-${n}`,
            userName: `p3-${n}@w.com`,
            active: true,
          })),
        },
      ];
      return { status: 200, body: pages[i++] };
    });
    const seats = await makeRealCursorClient({ fetchImpl, env: ENV }).listSeats();
    expect(seats).toHaveLength(250);
    expect(calls.map((c) => c.url)).toEqual([
      "https://cursor.com/api/scim/v2/Users?startIndex=1&count=100",
      "https://cursor.com/api/scim/v2/Users?startIndex=101&count=100",
      "https://cursor.com/api/scim/v2/Users?startIndex=201&count=100",
    ]);
  });

  it("falls back through displayName / name / email for the rendered name", async () => {
    const { fetchImpl } = makeMockFetch(() => ({
      status: 200,
      body: {
        schemas: [],
        totalResults: 3,
        itemsPerPage: 100,
        startIndex: 1,
        Resources: [
          { id: "1", userName: "a@w.com", displayName: "Alice", active: true },
          {
            id: "2",
            userName: "b@w.com",
            name: { givenName: "Bob", familyName: "Smith" },
            active: true,
          },
          { id: "3", userName: "c@w.com", active: true },
        ],
      },
    }));
    const seats = await makeRealCursorClient({ fetchImpl, env: ENV }).listSeats();
    expect(seats.map((s) => s.displayName)).toEqual(["Alice", "Bob Smith", "c@w.com"]);
  });

  it("throws IntegrationError when env vars are missing", async () => {
    const c = makeRealCursorClient({
      fetchImpl: makeMockFetch(() => ({ status: 200 })).fetchImpl,
      env: { CURSOR_SCIM_BASE_URL: "x" }, // missing token
    });
    await expect(c.listSeats()).rejects.toThrow(IntegrationError);
  });

  it("accepts CURSOR_TEAM_ADMIN_API_KEY when CURSOR_ADMIN_TOKEN is unset", async () => {
    const { fetchImpl, calls } = makeMockFetch(() => ({
      status: 200,
      body: {
        schemas: [],
        totalResults: 1,
        itemsPerPage: 100,
        startIndex: 1,
        Resources: [{ id: "u-1", userName: "a@w.com", active: true }],
      },
    }));
    const seats = await makeRealCursorClient({
      fetchImpl,
      env: {
        CURSOR_SCIM_BASE_URL: ENV.CURSOR_SCIM_BASE_URL,
        CURSOR_TEAM_ADMIN_API_KEY: "team-admin-key",
      },
    }).listSeats();
    expect(seats).toHaveLength(1);
    expect(calls[0].headers["authorization"]).toBe("Bearer team-admin-key");
  });

  it("strips trailing slash from CURSOR_SCIM_BASE_URL", async () => {
    const { fetchImpl, calls } = makeMockFetch(() => ({
      status: 200,
      body: { schemas: [], totalResults: 0, itemsPerPage: 100, startIndex: 1, Resources: [] },
    }));
    await makeRealCursorClient({
      fetchImpl,
      env: { ...ENV, CURSOR_SCIM_BASE_URL: "https://cursor.com/api/scim/v2/" },
    }).listSeats();
    expect(calls[0].url).toBe("https://cursor.com/api/scim/v2/Users?startIndex=1&count=100");
  });
});

describe("makeRealCursorClient.listWaitlist", () => {
  it("returns [] regardless of env (Cursor has no waitlist concept)", async () => {
    const { fetchImpl, calls } = makeMockFetch(() => ({ status: 500 }));
    const c = makeRealCursorClient({ fetchImpl, env: ENV });
    expect(await c.listWaitlist()).toEqual([]);
    // Doesn't call out at all.
    expect(calls).toHaveLength(0);
  });
});
