import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CHATGPT_CAP_USD_MONTH, CODEX_TIERS } from "@/lib/program";
import { IntegrationError } from "../errors";
import { makeRealOpenAIClient } from "./real";

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
  OPENAI_ADMIN_API_KEY: "sk-admin-test",
  OPENAI_ORG_ID: "org-test",
};

describe("makeRealOpenAIClient", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("real fetch invoked — test forgot to inject fetchImpl");
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("paginates through has_more=true pages and merges users", async () => {
    let cursor = 0;
    const { fetchImpl, calls } = makeMockFetch(() => {
      const pages = [
        {
          data: [
            { object: "organization.user", id: "u_1", email: "a@w.com", name: "A", role: "reader" },
            { object: "organization.user", id: "u_2", email: "b@w.com", name: null, role: "reader" },
          ],
          first_id: "u_1",
          last_id: "u_2",
          has_more: true,
        },
        {
          data: [
            { object: "organization.user", id: "u_3", email: "c@w.com", name: "C", role: "owner" },
          ],
          first_id: "u_3",
          last_id: "u_3",
          has_more: false,
        },
      ];
      return { status: 200, body: pages[cursor++] };
    });

    const c = makeRealOpenAIClient({ fetchImpl, env: ENV });
    const seats = await c.listChatGptSeats();

    expect(seats).toHaveLength(3);
    expect(seats[0]).toEqual({
      userId: "u_1",
      email: "a@w.com",
      displayName: "A",
      capUsdMonth: CHATGPT_CAP_USD_MONTH,
      mtdSpendUsd: 0,
    });
    // null name falls back to email.
    expect(seats[1].displayName).toBe("b@w.com");

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("limit=100");
    expect(calls[1].url).toContain("after=u_2");
  });

  it("attaches Authorization + OpenAI-Organization headers on every page", async () => {
    const { fetchImpl, calls } = makeMockFetch(() => ({
      status: 200,
      body: { data: [], has_more: false },
    }));
    await makeRealOpenAIClient({ fetchImpl, env: ENV }).listChatGptSeats();
    expect(calls[0].headers["authorization"]).toBe("Bearer sk-admin-test");
    expect(calls[0].headers["openai-organization"]).toBe("org-test");
  });

  it("listCodexSeats returns DISCOVERY-tier defaults flagged for policy-repo join", async () => {
    const { fetchImpl } = makeMockFetch(() => ({
      status: 200,
      body: {
        data: [
          { object: "organization.user", id: "u_1", email: "a@w.com", name: "A", role: "reader" },
        ],
        has_more: false,
      },
    }));
    const seats = await makeRealOpenAIClient({ fetchImpl, env: ENV }).listCodexSeats();
    expect(seats).toHaveLength(1);
    expect(seats[0]).toMatchObject({
      userId: "u_1",
      email: "a@w.com",
      subTier: "DISCOVERY",
      capUsdMonth: CODEX_TIERS.DISCOVERY.capUsdMonth,
      mtdSpendUsd: 0,
      lastActivityTs: null,
      idleDays: null,
    });
  });

  it("throws IntegrationError when env vars are missing", async () => {
    const c = makeRealOpenAIClient({
      fetchImpl: makeMockFetch(() => ({ status: 200 })).fetchImpl,
      env: { OPENAI_ADMIN_API_KEY: "k" }, // missing org id
    });
    await expect(c.listChatGptSeats()).rejects.toThrow(IntegrationError);
  });

  it("propagates non-2xx as IntegrationError", async () => {
    const { fetchImpl } = makeMockFetch(() => ({
      status: 401,
      body: { error: { message: "invalid key" } },
    }));
    await expect(
      makeRealOpenAIClient({ fetchImpl, env: ENV }).listChatGptSeats(),
    ).rejects.toThrow(IntegrationError);
  });
});
