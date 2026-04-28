/**
 * Real AnthropicClient — calls the Anthropic Workspaces Admin API for
 * Claude.ai workspace membership.
 *
 * Endpoint:
 *   GET https://api.anthropic.com/v1/organizations/
 *       {ANTHROPIC_ORG_ID}/workspaces/{ANTHROPIC_WORKSPACE_ID}/members
 *     ?limit=100&before_id=...
 *
 * Auth:
 *   x-api-key:        <ANTHROPIC_ADMIN_API_KEY>
 *   anthropic-version: 2023-06-01
 *
 * As with the OpenAI real client, the Anthropic Admin API exposes
 * membership but not per-seat USD caps or sub-tiers — those are
 * dashboard / policy-repo state. So `listSeats()` returns one
 * `ClaudeSeat` per workspace member, with `capUsdMonth` defaulted from
 * `lib/program.ts` and `subTier` set to a placeholder string until the
 * policy-repo join lands (v0.4).
 *
 * Refs: scoping §4 integration #6.
 */

import { paginate, type Fetch } from "../_http";
import { IntegrationError } from "../errors";
import { CLAUDE_CAP_USD_MONTH } from "@/lib/program";
import type { AnthropicClient, ClaudeSeat } from "./types";

const API_BASE = "https://api.anthropic.com/v1";

type Env = {
  apiKey: string;
  orgId: string;
  workspaceId: string;
};

function readEnv(env: Record<string, string | undefined> = process.env): Env {
  const apiKey = env.ANTHROPIC_ADMIN_API_KEY;
  const orgId = env.ANTHROPIC_ORG_ID;
  const workspaceId = env.ANTHROPIC_WORKSPACE_ID;
  if (!apiKey || !orgId || !workspaceId) {
    throw new IntegrationError(
      "anthropic",
      "ANTHROPIC_ADMIN_API_KEY / ANTHROPIC_ORG_ID / ANTHROPIC_WORKSPACE_ID must be set when INTEGRATION_ANTHROPIC=real.",
    );
  }
  return { apiKey, orgId, workspaceId };
}

function authHeaders(env: Env): Record<string, string> {
  return {
    "x-api-key": env.apiKey,
    "anthropic-version": "2023-06-01",
  };
}

type Member = {
  type: "workspace_member";
  user_id: string;
  email_address: string;
  workspace_role: string;
};

type MembersPage = {
  data: Member[];
  has_more: boolean;
  /** Cursor — Anthropic uses `last_id` for forward pagination. */
  last_id?: string;
};

async function listMembers(env: Env, fetchImpl?: Fetch): Promise<Member[]> {
  return paginate<MembersPage, Member>({
    integration: "anthropic",
    fetchImpl,
    initialUrl: `${API_BASE}/organizations/${env.orgId}/workspaces/${env.workspaceId}/members?limit=100`,
    headers: authHeaders(env),
    extractItems: (p) => p.data,
    nextUrl: (p, url) => {
      if (!p.has_more || !p.last_id) return null;
      const u = new URL(url);
      u.searchParams.set("after_id", p.last_id);
      return u.toString();
    },
  });
}

export function makeRealAnthropicClient(opts?: {
  fetchImpl?: Fetch;
  env?: Record<string, string | undefined>;
}): AnthropicClient {
  return {
    async listSeats(): Promise<ClaudeSeat[]> {
      const env = readEnv(opts?.env);
      const members = await listMembers(env, opts?.fetchImpl);
      // TODO(v0.4): join policy-repo state to derive subTier per user.
      // Until then everyone gets the documentation_heavy placeholder
      // matching the v0.1 synthetic shape so dashboard code that
      // groups by subTier doesn't NPE.
      const defaultTier = "documentation_heavy";
      return members.map((m) => ({
        userId: m.user_id,
        email: m.email_address,
        subTier: defaultTier,
        capUsdMonth: CLAUDE_CAP_USD_MONTH,
      }));
    },
  };
}

export const realAnthropicClient = makeRealAnthropicClient();
