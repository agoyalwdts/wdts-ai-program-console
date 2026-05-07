import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRealCursorClient } from "./real";

const mockList = vi.fn();

vi.mock("./prisma-cursor-seats", () => ({
  listCursorSeatsFromPrisma: () => mockList(),
}));

const SCIM_ENV = {
  CURSOR_SCIM_BASE_URL: "https://cursor.com/api/scim/v2",
  CURSOR_ADMIN_TOKEN: "scim-test-token",
};

type Recorded = { url: string; method: string; headers: Record<string, string> };

function makeMockFetch(
  responder: (req: Recorded) => { status: number; body?: unknown },
): typeof fetch {
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const req: Recorded = { url, method: init?.method ?? "GET", headers };
    const r = responder(req);
    return new Response(JSON.stringify(r.body ?? {}), {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return fetchImpl;
}

describe("makeRealCursorClient.listSeats", () => {
  beforeEach(() => {
    mockList.mockReset();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("real fetch invoked — test forgot to inject fetchImpl");
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns Prisma-only when SCIM env is unset", async () => {
    mockList.mockResolvedValue([
      {
        userId: "uuid-1",
        email: "alice@wdts.com",
        displayName: "Alice",
        subTier: "STANDARD",
        lastActivityTs: null,
        idleDays: null,
        mtdSpendUsd: 12.5,
      },
    ]);
    const seats = await makeRealCursorClient({ env: {} }).listSeats();
    expect(seats).toHaveLength(1);
    expect(seats[0]?.email).toBe("alice@wdts.com");
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it("merges SCIM members with Prisma seats when SCIM is configured", async () => {
    mockList.mockResolvedValue([
      {
        userId: "uuid-a",
        email: "alice@w.com",
        displayName: "Alice",
        subTier: "POWER",
        lastActivityTs: null,
        idleDays: 1,
        mtdSpendUsd: 9,
      },
    ]);
    const fetchImpl = makeMockFetch(() => ({
      status: 200,
      body: {
        schemas: [],
        totalResults: 2,
        itemsPerPage: 100,
        startIndex: 1,
        Resources: [
          {
            id: "scim-1",
            userName: "alice@w.com",
            displayName: "Alice SCIM",
            active: true,
          },
          {
            id: "scim-2",
            userName: "bob@w.com",
            displayName: "Bob",
            active: true,
          },
        ],
      },
    }));
    const seats = await makeRealCursorClient({
      env: SCIM_ENV,
      fetchImpl,
    }).listSeats();
    expect(seats).toHaveLength(2);
    expect(seats.find((s) => s.email === "alice@w.com")?.userId).toBe("uuid-a");
    expect(seats.find((s) => s.email === "alice@w.com")?.subTier).toBe("POWER");
    const bob = seats.find((s) => s.email === "bob@w.com");
    expect(bob?.userId).toBe("scim:scim-2");
    expect(bob?.subTier).toBe("STANDARD");
    expect(bob?.mtdSpendUsd).toBe(0);
  });

  it("falls back to Prisma-only when SCIM request throws", async () => {
    mockList.mockResolvedValue([
      {
        userId: "u1",
        email: "a@w.com",
        displayName: "A",
        subTier: "LIGHT",
        lastActivityTs: null,
        idleDays: null,
        mtdSpendUsd: 0,
      },
    ]);
    const errFetch = (async () =>
      new Response("nope", { status: 503 })) as typeof fetch;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const seats = await makeRealCursorClient({
      env: SCIM_ENV,
      fetchImpl: errFetch,
    }).listSeats();
    expect(seats).toHaveLength(1);
    expect(seats[0]?.email).toBe("a@w.com");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("makeRealCursorClient.listWaitlist", () => {
  it("returns []", async () => {
    expect(await makeRealCursorClient().listWaitlist()).toEqual([]);
  });
});
