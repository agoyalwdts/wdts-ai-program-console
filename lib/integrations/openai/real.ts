/**
 * Real OpenAIClient — calls the OpenAI Admin API for ChatGPT + Codex
 * seat state. Used when `INTEGRATION_OPENAI=real`.
 *
 * Endpoint:
 *   GET https://api.openai.com/v1/organization/users
 *     ?limit=100&after=<cursor>
 *
 * Auth:
 *   Authorization: Bearer <OPENAI_ADMIN_API_KEY>
 *   OpenAI-Organization: <OPENAI_ORG_ID>
 *
 * The OpenAI Admin API exposes who has org access but does NOT expose
 * per-seat USD caps or per-seat sub-tiers — those are policy state that
 * the dashboard / policy repo own. So:
 *
 *   - `listChatGptSeats()` returns one seat per user from the API,
 *     with `capUsdMonth` defaulted from `lib/program.ts` and
 *     `mtdSpendUsd` set to 0 (per-seat spend is not on this Admin endpoint;
 *     F1 totals for ChatGPT/Codex can use `VendorDailySpend` from the
 *     organization costs sync — see `lib/vendor-spend/sync-openai-vendor-daily.ts`).
 *   - `listCodexSeats()` does the same but assigns the lowest tier
 *     ("DISCOVERY") as a deliberate TODO marker — WDTS's
 *     user-id → sub-tier mapping comes from the policy repo, not the
 *     OpenAI API. A future integration step joins the policy state in.
 *
 * This is intentional: the v0.3 real client honours the strategic
 * posture (vendor APIs are read-only / authoritative for membership;
 * the policy repo is authoritative for entitlement). A future PR
 * lands the policy-repo read path that lets these methods return
 * true sub-tier state.
 *
 * Refs: scoping §4 integration #5; §4.6.2 Codex tiers; AGENTS.md §3.
 */

import { paginate, type Fetch } from "../_http";
import { IntegrationError } from "../errors";
import { CHATGPT_CAP_USD_MONTH, CODEX_TIERS } from "@/lib/program";
import type {
  ChatGptSeat,
  CodexSeat,
  CodexSubTier,
  OpenAIClient,
} from "./types";

const API_BASE = "https://api.openai.com/v1";

type Env = {
  apiKey: string;
  orgId: string;
};

function readEnv(env: Record<string, string | undefined> = process.env): Env {
  const apiKey = env.OPENAI_ADMIN_API_KEY;
  const orgId = env.OPENAI_ORG_ID;
  if (!apiKey || !orgId) {
    throw new IntegrationError(
      "openai",
      "OPENAI_ADMIN_API_KEY and OPENAI_ORG_ID must be set when INTEGRATION_OPENAI=real.",
    );
  }
  return { apiKey, orgId };
}

function authHeaders(env: Env): Record<string, string> {
  return {
    Authorization: `Bearer ${env.apiKey}`,
    "OpenAI-Organization": env.orgId,
  };
}

/** Single user record from `/organization/users` (subset). */
type OrgUser = {
  object: "organization.user";
  id: string;
  email: string;
  name: string | null;
  role: "owner" | "reader";
  added_at?: number;
};

type OrgUsersPage = {
  object: "list";
  data: OrgUser[];
  first_id?: string;
  last_id?: string;
  has_more: boolean;
};

async function listOrgUsers(env: Env, fetchImpl?: Fetch): Promise<OrgUser[]> {
  return paginate<OrgUsersPage, OrgUser>({
    integration: "openai",
    fetchImpl,
    initialUrl: `${API_BASE}/organization/users?limit=100`,
    headers: authHeaders(env),
    extractItems: (p) => p.data,
    nextUrl: (p, url) => {
      if (!p.has_more || !p.last_id) return null;
      const u = new URL(url);
      u.searchParams.set("after", p.last_id);
      return u.toString();
    },
  });
}

/** ChatGPT cap is a flat $/month per scoping §4.6.2. */
const CHATGPT_DEFAULT_CAP = CHATGPT_CAP_USD_MONTH;
/** Codex DISCOVERY cap — the lowest tier — used as a deliberate floor
 *  when the policy-repo join hasn't run yet (see TODO note above). */
const CODEX_DEFAULT_CAP = CODEX_TIERS.DISCOVERY.capUsdMonth;

/** Factory exported for tests; also wired as the default singleton. */
export function makeRealOpenAIClient(opts?: {
  fetchImpl?: Fetch;
  env?: Record<string, string | undefined>;
}): OpenAIClient {
  return {
    async listChatGptSeats(): Promise<ChatGptSeat[]> {
      const env = readEnv(opts?.env);
      const users = await listOrgUsers(env, opts?.fetchImpl);
      return users.map((u) => ({
        userId: u.id,
        email: u.email,
        displayName: u.name ?? u.email,
        capUsdMonth: CHATGPT_DEFAULT_CAP,
        // The OpenAI Admin API doesn't expose MTD spend on the user
        // record. Real spend comes from GatewayClient; UI should join.
        mtdSpendUsd: 0,
      }));
    },

    async listCodexSeats(): Promise<CodexSeat[]> {
      const env = readEnv(opts?.env);
      const users = await listOrgUsers(env, opts?.fetchImpl);
      // TODO(v0.4): join policy-repo state to derive subTier per user.
      // DISCOVERY as default makes "incorrect" cases visible — a
      // POWER user mis-classified as DISCOVERY shows up immediately
      // on F9, where DISCOVERY users are a minority.
      const defaultTier: CodexSubTier = "DISCOVERY";
      return users.map((u) => ({
        userId: u.id,
        email: u.email,
        displayName: u.name ?? u.email,
        subTier: defaultTier,
        capUsdMonth: CODEX_DEFAULT_CAP,
        mtdSpendUsd: 0,
        lastActivityTs: null,
        idleDays: null,
      }));
    },
  };
}

export const realOpenAIClient = makeRealOpenAIClient();
