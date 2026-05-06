import { afterEach, describe, expect, it, vi } from "vitest";
import { IntegrationError } from "../errors";
import {
  clearCursorTeamEtagCacheForTests,
  cursorTeamGetJson,
  cursorTeamPostJson,
} from "./cursor-team-http";

describe("cursorTeamGetJson", () => {
  afterEach(() => {
    clearCursorTeamEtagCacheForTests();
  });
  it("GETs api.cursor.com with Basic auth and returns JSON", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe(
        "https://api.cursor.com/analytics/team/dau?startDate=7d&endDate=today",
      );
      return new Response(JSON.stringify({ data: [{ dau: 3 }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const body = await cursorTeamGetJson({
      path: "/analytics/team/dau",
      query: { startDate: "7d", endDate: "today" },
      apiKey: "crsr_test",
      fetchImpl,
    });
    expect(body).toEqual({ data: [{ dau: 3 }] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = vi.mocked(fetchImpl).mock.calls[0][1] as RequestInit | undefined;
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      `Basic ${Buffer.from("crsr_test:").toString("base64")}`,
    );
  });

  it("throws IntegrationError on non-JSON body", async () => {
    const fetchImpl = vi.fn(async () => new Response("not json", { status: 200 })) as typeof fetch;
    await expect(
      cursorTeamGetJson({
        path: "/v1/me",
        apiKey: "k",
        fetchImpl,
      }),
    ).rejects.toThrow(IntegrationError);
  });

  it("returns cached body on 304 when ETag cache is forced", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const inm = new Headers(init?.headers).get("If-None-Match");
        if (inm === '"v1"') {
          return new Response(null, { status: 304 });
        }
        return new Response(JSON.stringify({ n: 1 }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ETag: '"v1"',
          },
        });
      },
    ) as typeof fetch;

    const first = await cursorTeamGetJson<{ n: number }>({
      path: "/analytics/team/dau",
      query: { startDate: "7d", endDate: "today" },
      apiKey: "k",
      fetchImpl,
      forceEtagCache: true,
    });
    expect(first).toEqual({ n: 1 });
    const second = await cursorTeamGetJson<{ n: number }>({
      path: "/analytics/team/dau",
      query: { startDate: "7d", endDate: "today" },
      apiKey: "k",
      fetchImpl,
      forceEtagCache: true,
    });
    expect(second).toEqual({ n: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("cursorTeamPostJson", () => {
  it("POSTs JSON with Basic auth", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.cursor.com/teams/spend");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("Content-Type")).toContain("application/json");
      return new Response(JSON.stringify({ teamMemberSpend: [], totalPages: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const body = await cursorTeamPostJson({
      path: "/teams/spend",
      body: { page: 1, pageSize: 10 },
      apiKey: "crsr_test",
      fetchImpl,
    });
    expect(body).toEqual({ teamMemberSpend: [], totalPages: 1 });
  });
});
