/**
 * Unit tests for the real policy-repo client. Uses a hand-rolled fetch
 * mock that records the request sequence + payloads, so the suite
 * doubles as a contract test against the GitHub REST API endpoints
 * the client targets.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrationError } from "../errors";
import { makeRealPolicyRepoClient } from "./real";
import type { PolicyChange } from "./types";

type Recorded = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
};

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
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const req: Recorded = { url, method: init?.method ?? "GET", headers, body };
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
  POLICYREPO_OWNER: "wdts",
  POLICYREPO_NAME: "wdts-ai-policy",
  POLICYREPO_TOKEN: "ghp_test_token",
  POLICYREPO_DEFAULT_BRANCH: "main",
};

const CHANGE: PolicyChange = {
  title: "Promote alice@wdts.com to codex_power",
  files: [
    { path: "tiers/codex.yaml", content: "alice@wdts.com: codex_power\n" },
    { path: "audit/2026-04-28.md", content: "- promotion: alice → codex_power\n" },
  ],
  body: "Tier promotion per Decision row.",
  decisionId: "dec_abc123",
  authorEmail: "anuj@wdts.com",
};

describe("makeRealPolicyRepoClient", () => {
  beforeEach(() => {
    // No real network in this suite. Any fetch leak surfaces as an
    // explicit error rather than a timeout.
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("real fetch invoked — test forgot to inject fetchImpl");
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("performs the full open-PR sequence in order", async () => {
    const { fetchImpl, calls } = makeMockFetch((req) => {
      if (req.url.endsWith("/git/ref/heads/main")) {
        return { status: 200, body: { object: { sha: "base-sha" } } };
      }
      if (req.url.endsWith("/git/refs") && req.method === "POST") {
        return { status: 201 };
      }
      if (req.url.includes("/contents/") && req.method === "GET") {
        // both files don't exist on the new branch yet → 404
        return { status: 404, body: { message: "Not Found" } };
      }
      if (req.url.includes("/contents/") && req.method === "PUT") {
        return { status: 201, body: { content: { sha: "new-blob-sha" } } };
      }
      if (req.url.endsWith("/pulls") && req.method === "POST") {
        return {
          status: 201,
          body: {
            number: 7,
            html_url: "https://github.com/wdts/wdts-ai-policy/pull/7",
            state: "open",
          },
        };
      }
      return { status: 500, body: { unexpected: req.url } };
    });

    const client = makeRealPolicyRepoClient({ fetchImpl, env: ENV });
    const pr = await client.openPullRequest(CHANGE);

    expect(pr).toEqual({
      number: 7,
      url: "https://github.com/wdts/wdts-ai-policy/pull/7",
      branch: "dashboard/dec_abc123",
      state: "OPEN",
    });

    // Sequence: 1 GET ref + 1 POST refs + (1 GET contents + 1 PUT contents)
    // per file + 1 POST pulls = 1 + 1 + 4 + 1 = 7 calls for two files.
    expect(calls).toHaveLength(7);
    expect(calls[0]).toMatchObject({
      url: expect.stringContaining("/git/ref/heads/main"),
      method: "GET",
    });
    expect(calls[1]).toMatchObject({
      url: expect.stringContaining("/git/refs"),
      method: "POST",
      body: { ref: "refs/heads/dashboard/dec_abc123", sha: "base-sha" },
    });
    expect(calls[6]).toMatchObject({
      url: expect.stringContaining("/pulls"),
      method: "POST",
      body: expect.objectContaining({
        title: CHANGE.title,
        head: "dashboard/dec_abc123",
        base: "main",
      }),
    });
  });

  it("base64-encodes file contents and includes branch + author in PUT", async () => {
    const { fetchImpl, calls } = makeMockFetch((req) => {
      if (req.url.endsWith("/git/ref/heads/main")) {
        return { status: 200, body: { object: { sha: "base" } } };
      }
      if (req.url.includes("/git/refs")) return { status: 201 };
      if (req.url.includes("/contents/") && req.method === "GET") {
        return { status: 404 };
      }
      if (req.url.includes("/contents/") && req.method === "PUT") {
        return { status: 201, body: { content: { sha: "x" } } };
      }
      return {
        status: 201,
        body: { number: 1, html_url: "u", state: "open" },
      };
    });

    const client = makeRealPolicyRepoClient({ fetchImpl, env: ENV });
    await client.openPullRequest(CHANGE);

    const put = calls.find((c) => c.method === "PUT" && c.url.includes("/contents/"));
    expect(put).toBeDefined();
    const body = put!.body as {
      message: string;
      content: string;
      branch: string;
      author: { email: string };
    };
    expect(body.branch).toBe("dashboard/dec_abc123");
    expect(body.author.email).toBe("anuj@wdts.com");
    expect(body.message).toContain("[decision: dec_abc123]");
    // base64-encoded content is the original bytes round-tripped.
    const decoded = Buffer.from(body.content, "base64").toString("utf-8");
    expect(decoded).toBe("alice@wdts.com: codex_power\n");
  });

  it("appends 'Decision: <id>' to the PR body even when body is empty", async () => {
    const { fetchImpl, calls } = makeMockFetch((req) => {
      if (req.url.endsWith("/git/ref/heads/main")) {
        return { status: 200, body: { object: { sha: "x" } } };
      }
      if (req.url.includes("/git/refs")) return { status: 201 };
      if (req.url.includes("/contents/") && req.method === "GET") {
        return { status: 404 };
      }
      if (req.url.includes("/contents/") && req.method === "PUT") {
        return { status: 201, body: {} };
      }
      return {
        status: 201,
        body: { number: 1, html_url: "u", state: "open" },
      };
    });
    const client = makeRealPolicyRepoClient({ fetchImpl, env: ENV });
    await client.openPullRequest({ ...CHANGE, body: undefined });
    const pulls = calls.find((c) => c.url.endsWith("/pulls"))!;
    expect((pulls.body as { body: string }).body).toContain("Decision: dec_abc123");
  });

  it("uses the existing file's sha when updating (not creating)", async () => {
    const { fetchImpl, calls } = makeMockFetch((req) => {
      if (req.url.endsWith("/git/ref/heads/main")) {
        return { status: 200, body: { object: { sha: "x" } } };
      }
      if (req.url.includes("/git/refs")) return { status: 201 };
      if (req.url.includes("/contents/") && req.method === "GET") {
        return { status: 200, body: { sha: "existing-blob-sha" } };
      }
      if (req.url.includes("/contents/") && req.method === "PUT") {
        return { status: 200, body: {} };
      }
      return {
        status: 201,
        body: { number: 1, html_url: "u", state: "open" },
      };
    });
    const client = makeRealPolicyRepoClient({ fetchImpl, env: ENV });
    await client.openPullRequest({ ...CHANGE, files: [CHANGE.files[0]] });
    const put = calls.find((c) => c.method === "PUT" && c.url.includes("/contents/"))!;
    expect((put.body as { sha?: string }).sha).toBe("existing-blob-sha");
  });

  it("attaches Authorization + GitHub headers on every call", async () => {
    const { fetchImpl, calls } = makeMockFetch((req) => {
      if (req.url.endsWith("/git/ref/heads/main")) {
        return { status: 200, body: { object: { sha: "x" } } };
      }
      if (req.url.includes("/git/refs")) return { status: 201 };
      if (req.url.includes("/contents/") && req.method === "GET") {
        return { status: 404 };
      }
      if (req.url.includes("/contents/") && req.method === "PUT") {
        return { status: 201, body: {} };
      }
      return {
        status: 201,
        body: { number: 1, html_url: "u", state: "open" },
      };
    });
    const client = makeRealPolicyRepoClient({ fetchImpl, env: ENV });
    await client.openPullRequest({ ...CHANGE, files: [CHANGE.files[0]] });
    for (const call of calls) {
      expect(call.headers["authorization"]).toBe("Bearer ghp_test_token");
      expect(call.headers["accept"]).toBe("application/vnd.github+json");
      expect(call.headers["x-github-api-version"]).toBe("2022-11-28");
    }
  });

  it("rejects empty file lists locally rather than calling GitHub", async () => {
    const { fetchImpl, calls } = makeMockFetch(() => ({ status: 500 }));
    const client = makeRealPolicyRepoClient({ fetchImpl, env: ENV });
    await expect(
      client.openPullRequest({ ...CHANGE, files: [] }),
    ).rejects.toThrow(IntegrationError);
    expect(calls).toHaveLength(0);
  });

  it("throws IntegrationError when env vars are missing", async () => {
    const client = makeRealPolicyRepoClient({
      fetchImpl: makeMockFetch(() => ({ status: 200 })).fetchImpl,
      env: { POLICYREPO_OWNER: "wdts" }, // missing name + token
    });
    await expect(client.openPullRequest(CHANGE)).rejects.toThrow(IntegrationError);
  });

  it("getPullRequest returns null on 404", async () => {
    const { fetchImpl } = makeMockFetch(() => ({ status: 404, body: { message: "Not Found" } }));
    const client = makeRealPolicyRepoClient({ fetchImpl, env: ENV });
    expect(await client.getPullRequest(123)).toBeNull();
  });

  it("getPullRequest hydrates fields from GitHub response", async () => {
    const { fetchImpl } = makeMockFetch(() => ({
      status: 200,
      body: {
        number: 9,
        html_url: "https://github.com/wdts/wdts-ai-policy/pull/9",
        state: "merged",
        head: { ref: "dashboard/dec_z" },
      },
    }));
    const client = makeRealPolicyRepoClient({ fetchImpl, env: ENV });
    expect(await client.getPullRequest(9)).toEqual({
      number: 9,
      url: "https://github.com/wdts/wdts-ai-policy/pull/9",
      branch: "dashboard/dec_z",
      state: "MERGED",
    });
  });

  it("propagates non-404 errors as IntegrationError", async () => {
    const { fetchImpl } = makeMockFetch(() => ({
      status: 500,
      body: { message: "boom" },
    }));
    const client = makeRealPolicyRepoClient({ fetchImpl, env: ENV });
    await expect(client.getPullRequest(1)).rejects.toThrow(IntegrationError);
  });
});
