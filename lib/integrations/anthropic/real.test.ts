import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLAUDE_CAP_USD_MONTH } from "@/lib/program";
import { IntegrationError } from "../errors";
import { makeRealAnthropicClient } from "./real";

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
  ANTHROPIC_ADMIN_API_KEY: "sk-ant-admin-test",
  ANTHROPIC_ORG_ID: "org-test",
  ANTHROPIC_WORKSPACE_ID: "ws-test",
};

describe("makeRealAnthropicClient", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("real fetch invoked — test forgot to inject fetchImpl");
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("hits the workspace-members endpoint and maps to ClaudeSeat[]", async () => {
    const { fetchImpl, calls } = makeMockFetch(() => ({
      status: 200,
      body: {
        data: [
          {
            type: "workspace_member",
            user_id: "u_1",
            email_address: "a@w.com",
            workspace_role: "workspace_user",
          },
          {
            type: "workspace_member",
            user_id: "u_2",
            email_address: "b@w.com",
            workspace_role: "workspace_admin",
          },
        ],
        has_more: false,
      },
    }));

    const seats = await makeRealAnthropicClient({ fetchImpl, env: ENV }).listSeats();

    expect(seats).toHaveLength(2);
    expect(seats[0]).toEqual({
      userId: "u_1",
      email: "a@w.com",
      subTier: "documentation_heavy",
      capUsdMonth: CLAUDE_CAP_USD_MONTH,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/organizations/org-test/workspaces/ws-test/members");
  });

  it("paginates with after_id when has_more=true", async () => {
    let i = 0;
    const { fetchImpl, calls } = makeMockFetch(() => {
      const pages = [
        {
          data: [
            { type: "workspace_member", user_id: "u_1", email_address: "a@w.com", workspace_role: "x" },
          ],
          has_more: true,
          last_id: "u_1",
        },
        {
          data: [
            { type: "workspace_member", user_id: "u_2", email_address: "b@w.com", workspace_role: "x" },
          ],
          has_more: false,
        },
      ];
      return { status: 200, body: pages[i++] };
    });

    const seats = await makeRealAnthropicClient({ fetchImpl, env: ENV }).listSeats();
    expect(seats.map((s) => s.userId)).toEqual(["u_1", "u_2"]);
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain("after_id=u_1");
  });

  it("attaches x-api-key + anthropic-version headers", async () => {
    const { fetchImpl, calls } = makeMockFetch(() => ({
      status: 200,
      body: { data: [], has_more: false },
    }));
    await makeRealAnthropicClient({ fetchImpl, env: ENV }).listSeats();
    expect(calls[0].headers["x-api-key"]).toBe("sk-ant-admin-test");
    expect(calls[0].headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("throws IntegrationError when env vars are missing", async () => {
    const c = makeRealAnthropicClient({
      fetchImpl: makeMockFetch(() => ({ status: 200 })).fetchImpl,
      env: { ANTHROPIC_ADMIN_API_KEY: "k" }, // missing org + workspace
    });
    await expect(c.listSeats()).rejects.toThrow(IntegrationError);
  });

  it("propagates non-2xx as IntegrationError", async () => {
    const { fetchImpl } = makeMockFetch(() => ({
      status: 403,
      body: { error: { type: "permission_error", message: "no access" } },
    }));
    await expect(
      makeRealAnthropicClient({ fetchImpl, env: ENV }).listSeats(),
    ).rejects.toThrow(IntegrationError);
  });
});
