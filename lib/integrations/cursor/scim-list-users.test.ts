import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listScimUsers, readScimEnv } from "./scim-list-users";

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

describe("readScimEnv", () => {
  it("returns null when URL or token missing", () => {
    expect(readScimEnv({ CURSOR_SCIM_BASE_URL: "x" })).toBeNull();
    expect(readScimEnv({ CURSOR_ADMIN_TOKEN: "t" })).toBeNull();
  });

  it("strips trailing slash from base URL", () => {
    const e = readScimEnv({
      ...ENV,
      CURSOR_SCIM_BASE_URL: "https://cursor.com/api/scim/v2/",
    });
    expect(e?.baseUrl).toBe("https://cursor.com/api/scim/v2");
  });
});

describe("listScimUsers", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("real fetch invoked — test forgot to inject fetchImpl");
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("hits SCIM /Users with bearer + scim+json accept", async () => {
    const { fetchImpl, calls } = makeMockFetch(() => ({
      status: 200,
      body: {
        schemas: [],
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
    const users = await listScimUsers(readScimEnv(ENV)!, fetchImpl);
    expect(users).toEqual([
      { id: "u-1", email: "alice@wdts.com", displayName: "Alice", active: true },
    ]);
    expect(calls[0]?.url).toBe(
      "https://cursor.com/api/scim/v2/Users?startIndex=1&count=100",
    );
    expect(calls[0]?.headers["authorization"]).toBe("Bearer scim-test-token");
    expect(calls[0]?.headers["accept"]).toBe("application/scim+json");
  });

  it("paginates when totalResults > count", async () => {
    let i = 0;
    const { fetchImpl, calls } = makeMockFetch(() => {
      const pages = [
        {
          schemas: [],
          totalResults: 150,
          itemsPerPage: 100,
          startIndex: 1,
          Resources: Array.from({ length: 100 }, (_, n) => ({
            id: `p1-${n}`,
            userName: `a${n}@w.com`,
            active: true,
          })),
        },
        {
          schemas: [],
          totalResults: 150,
          itemsPerPage: 100,
          startIndex: 101,
          Resources: Array.from({ length: 50 }, (_, n) => ({
            id: `p2-${n}`,
            userName: `b${n}@w.com`,
            active: true,
          })),
        },
      ];
      return { status: 200, body: pages[i++] };
    });
    const users = await listScimUsers(readScimEnv(ENV)!, fetchImpl);
    expect(users).toHaveLength(150);
    expect(calls.map((c) => c.url)).toEqual([
      "https://cursor.com/api/scim/v2/Users?startIndex=1&count=100",
      "https://cursor.com/api/scim/v2/Users?startIndex=101&count=100",
    ]);
  });
});
