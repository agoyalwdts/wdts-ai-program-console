/**
 * Real PolicyRepoClient — opens PRs against the policy repo
 * (`agoyalwdts/wdts-ai-policy` by default, configurable via
 * `POLICYREPO_OWNER/POLICYREPO_NAME`) via the GitHub REST
 * API. Used when `INTEGRATION_POLICYREPO=real` (see lib/integrations/env.ts).
 *
 * Flow for `openPullRequest`:
 *   1. Resolve the default branch's HEAD SHA.
 *      GET /repos/{owner}/{repo}/git/ref/heads/{default}
 *   2. Create a fresh branch off that SHA.
 *      POST /repos/{owner}/{repo}/git/refs   { ref, sha }
 *   3. Write each file via the Contents API (one commit per file).
 *      PUT /repos/{owner}/{repo}/contents/{path}
 *        { message, content (base64), branch, sha? (when updating) }
 *   4. Open the PR head=<branch> base=<default>.
 *      POST /repos/{owner}/{repo}/pulls
 *
 * Choices that are deliberate:
 *   - Contents API rather than Git Data API. One commit per file is more
 *     audit-friendly than synthesising a tree object, and keeps the
 *     implementation small enough to read in one screen.
 *   - Token authentication via a fine-grained PAT in POLICYREPO_TOKEN.
 *     The token must have `contents:write` and `pull_requests:write` on
 *     the policy repo only. Branch protection on the policy repo is what
 *     stops the dashboard from merging its own PR — see scoping §4.
 *   - Branch name is `dashboard/<decisionId>`. Idempotent within a
 *     single Decision: re-running the same call against an existing
 *     branch is rejected by GitHub (422 ref already exists), which is
 *     the right behaviour — caller should treat that as "PR already
 *     exists, look it up via decision.evidenceLink".
 *
 * Required env vars (read at call-time, not at module-load, so that a
 * synthetic-mode dashboard never warms up real credentials):
 *   POLICYREPO_OWNER          — GitHub owner (org or user) of the policy repo.
 *   POLICYREPO_NAME           — repo name.
 *   POLICYREPO_TOKEN          — fine-grained PAT (contents:write,
 *                               pull_requests:write).
 *   POLICYREPO_DEFAULT_BRANCH — default branch (default: 'main').
 *
 * Refs: Dashboard_Scoping_v1.md §4 integration #8.
 */

import { IntegrationError } from "../errors";
import type {
  PolicyChange,
  PolicyFile,
  PolicyPullRequest,
  PolicyRepoClient,
} from "./types";

const GITHUB_API = "https://api.github.com";

type Env = {
  owner: string;
  repo: string;
  token: string;
  defaultBranch: string;
};

function readEnv(env: Record<string, string | undefined> = process.env): Env {
  const owner = env.POLICYREPO_OWNER;
  const repo = env.POLICYREPO_NAME;
  const token = env.POLICYREPO_TOKEN;
  if (!owner || !repo || !token) {
    throw new IntegrationError(
      "policyrepo",
      "POLICYREPO_OWNER / POLICYREPO_NAME / POLICYREPO_TOKEN must be set when INTEGRATION_POLICYREPO=real.",
    );
  }
  return {
    owner,
    repo,
    token,
    defaultBranch: env.POLICYREPO_DEFAULT_BRANCH ?? "main",
  };
}

type Fetch = typeof fetch;

/** UTF-8 safe base64 encoder. Avoids Buffer (Node-only) to keep the
 *  module edge-runtime-friendly. */
function toBase64(s: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(s, "utf-8").toString("base64");
  // Browser / edge fallback. We expect Node in practice but cover both.
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function ghFetch<T>(
  fetchImpl: Fetch,
  env: Env,
  path: string,
  init: RequestInit & { json?: unknown },
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${env.token}`);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetchImpl(`${GITHUB_API}${path}`, { ...init, headers, body });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new IntegrationError(
      "policyrepo",
      `${init.method ?? "GET"} ${path} → ${res.status} ${res.statusText}: ${text.slice(0, 500)}`,
    );
  }
  return (await res.json()) as T;
}

type RefResponse = { object: { sha: string } };
type ContentsResponse = { content: { sha: string } | null };
type ContentsGetResponse = { sha: string };
type PullsResponse = { number: number; html_url: string; state: string };

async function getDefaultBranchSha(f: Fetch, env: Env): Promise<string> {
  const r = await ghFetch<RefResponse>(
    f,
    env,
    `/repos/${env.owner}/${env.repo}/git/ref/heads/${env.defaultBranch}`,
    { method: "GET" },
  );
  return r.object.sha;
}

async function createBranch(
  f: Fetch,
  env: Env,
  branch: string,
  sha: string,
): Promise<void> {
  await ghFetch<unknown>(
    f,
    env,
    `/repos/${env.owner}/${env.repo}/git/refs`,
    { method: "POST", json: { ref: `refs/heads/${branch}`, sha } },
  );
}

async function getExistingFileSha(
  f: Fetch,
  env: Env,
  branch: string,
  path: string,
): Promise<string | undefined> {
  try {
    const r = await ghFetch<ContentsGetResponse>(
      f,
      env,
      `/repos/${env.owner}/${env.repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
      { method: "GET" },
    );
    return r.sha;
  } catch (err) {
    // 404 → file doesn't exist on this branch; that's fine.
    if (err instanceof IntegrationError && err.message.includes("404")) return undefined;
    throw err;
  }
}

async function writeFile(
  f: Fetch,
  env: Env,
  branch: string,
  file: PolicyFile,
  message: string,
  authorEmail: string,
): Promise<void> {
  const existingSha = await getExistingFileSha(f, env, branch, file.path);
  await ghFetch<ContentsResponse>(
    f,
    env,
    `/repos/${env.owner}/${env.repo}/contents/${encodeURIComponent(file.path)}`,
    {
      method: "PUT",
      json: {
        message,
        content: toBase64(file.content),
        branch,
        sha: existingSha,
        author: { name: authorEmail.split("@")[0], email: authorEmail },
        committer: { name: authorEmail.split("@")[0], email: authorEmail },
      },
    },
  );
}

async function openPr(
  f: Fetch,
  env: Env,
  branch: string,
  title: string,
  body: string,
): Promise<PolicyPullRequest> {
  const r = await ghFetch<PullsResponse>(
    f,
    env,
    `/repos/${env.owner}/${env.repo}/pulls`,
    {
      method: "POST",
      json: { title, body, head: branch, base: env.defaultBranch },
    },
  );
  return {
    number: r.number,
    url: r.html_url,
    branch,
    state: (r.state.toUpperCase() as "OPEN" | "MERGED" | "CLOSED") ?? "OPEN",
  };
}

async function getPr(
  f: Fetch,
  env: Env,
  num: number,
): Promise<PolicyPullRequest | null> {
  try {
    const r = await ghFetch<PullsResponse & { head: { ref: string } }>(
      f,
      env,
      `/repos/${env.owner}/${env.repo}/pulls/${num}`,
      { method: "GET" },
    );
    return {
      number: r.number,
      url: r.html_url,
      branch: r.head.ref,
      state: (r.state.toUpperCase() as "OPEN" | "MERGED" | "CLOSED") ?? "OPEN",
    };
  } catch (err) {
    if (err instanceof IntegrationError && err.message.includes("404")) return null;
    throw err;
  }
}

/** Factory — exported separately so tests can inject a mocked fetch.
 *  At runtime, `realPolicyRepoClient` (no args) reads the global
 *  `fetch` and `process.env`. */
export function makeRealPolicyRepoClient(opts?: {
  fetchImpl?: Fetch;
  env?: Record<string, string | undefined>;
}): PolicyRepoClient {
  const fetchImpl = opts?.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const envSrc = opts?.env;
  return {
    async openPullRequest(change: PolicyChange): Promise<PolicyPullRequest> {
      const env = readEnv(envSrc);
      if (change.files.length === 0) {
        throw new IntegrationError(
          "policyrepo",
          "PolicyChange.files must contain at least one entry — empty PRs are rejected upstream.",
        );
      }
      const branch = `dashboard/${change.decisionId}`;
      const baseSha = await getDefaultBranchSha(fetchImpl, env);
      await createBranch(fetchImpl, env, branch, baseSha);
      for (const file of change.files) {
        const message = `${change.title} [decision: ${change.decisionId}] (${file.path})`;
        await writeFile(fetchImpl, env, branch, file, message, change.authorEmail);
      }
      const body = [change.body ?? "", "", `Decision: ${change.decisionId}`]
        .filter(Boolean)
        .join("\n");
      return openPr(fetchImpl, env, branch, change.title, body);
    },

    async getPullRequest(number: number): Promise<PolicyPullRequest | null> {
      const env = readEnv(envSrc);
      return getPr(fetchImpl, env, number);
    },
  };
}

export const realPolicyRepoClient = makeRealPolicyRepoClient();
