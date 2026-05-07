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
 *   - `listCodexSeats()` unions OpenAI **org** `/organization/users` with Prisma
 *     `License` (CODEX) by email — program tier / cap wins when licensed; org-only
 *     members get a STANDARD placeholder (dashboard `User.id` when email matches
 *     Prisma, else `openai-org:<id>`). Falls back to Prisma-only if the Admin API
 *     fails. MTD / idle come from gateway `UsageRecord` after the merge.
 *
 * Refs: scoping §4 integration #5; §4.6.2 Codex tiers; AGENTS.md §3.
 */

import { paginate, type Fetch } from "../_http";
import { IntegrationError } from "../errors";
import { CHATGPT_CAP_USD_MONTH } from "@/lib/program";
import { prisma } from "@/lib/prisma";
import { mergeOrgUsersWithPrismaCodexSeats } from "./merge-org-prisma-codex-seats";
import { enrichCodexSeatsFromUsageRecords, listCodexSeatsFromPrisma } from "./prisma-codex-seats";
import type { ChatGptSeat, OpenAIClient } from "./types";

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

function normEmailForMerge(e: string): string {
  return e.trim().toLowerCase();
}

async function loadDashboardUserIdsByNormEmail(emails: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniq = [...new Set(emails.map(normEmailForMerge).filter(Boolean))];
  const chunkSize = 40;
  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize);
    if (chunk.length === 0) continue;
    const dbUsers = await prisma.user.findMany({
      where: {
        OR: chunk.map((e) => ({ email: { equals: e, mode: "insensitive" as const } })),
      },
      select: { id: true, email: true },
    });
    for (const u of dbUsers) {
      map.set(normEmailForMerge(u.email), u.id);
    }
  }
  return map;
}

/** ChatGPT cap is a flat $/month per scoping §4.6.2. */
const CHATGPT_DEFAULT_CAP = CHATGPT_CAP_USD_MONTH;

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

    async listCodexSeats() {
      const prismaSeats = await listCodexSeatsFromPrisma();
      try {
        const env = readEnv(opts?.env);
        const orgUsers = await listOrgUsers(env, opts?.fetchImpl);
        const orgMembers = orgUsers.map((u) => ({
          id: u.id,
          email: u.email,
          displayName: (u.name && u.name.trim()) || u.email,
        }));
        const licensedEmails = new Set(prismaSeats.map((s) => normEmailForMerge(s.email)));
        const emailsForLookup = orgMembers
          .map((m) => m.email)
          .filter((e) => {
            const k = normEmailForMerge(e);
            return k.length > 0 && !licensedEmails.has(k);
          });
        const dashboardUserIdByNormEmail = await loadDashboardUserIdsByNormEmail(emailsForLookup);
        const merged = mergeOrgUsersWithPrismaCodexSeats({
          orgMembers,
          prismaSeats,
          dashboardUserIdByNormEmail,
        });
        return enrichCodexSeatsFromUsageRecords(merged);
      } catch (err) {
        console.error(
          "[openai/real] listCodexSeats org union failed; using Prisma CODEX licenses only",
          err,
        );
        return prismaSeats;
      }
    },
  };
}

export const realOpenAIClient = makeRealOpenAIClient();
