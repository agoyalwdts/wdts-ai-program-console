/**
 * Real CursorClient — calls Cursor's SCIM 2.0 admin endpoint to list
 * workspace members. Cursor exposes user / seat membership via SCIM;
 * sub-tier and per-seat USD caps are policy state owned by the policy
 * repo (per AGENTS.md §3 strategic posture), not the vendor.
 *
 * SCIM 2.0 endpoint:
 *   GET <CURSOR_SCIM_BASE_URL>/Users
 *     ?startIndex=1&count=100
 *
 * The `CURSOR_SCIM_BASE_URL` env var is **required** when
 * `INTEGRATION_CURSOR=real`. WDTS Enterprise typically gets a SCIM URL
 * of the form `https://cursor.com/api/scim/v2` — but the exact path
 * depends on the workspace's SCIM provisioning configuration, so we
 * don't bake a default. Set it explicitly per environment.
 *
 * Auth: bearer token in `CURSOR_ADMIN_TOKEN`. SCIM 2.0 standard auth.
 *
 * Limitations of this client (call out at every consumer site):
 *
 *   - `subTier` is defaulted to "STANDARD" because SCIM doesn't carry
 *     per-user tier. The policy-repo join (v0.4) provides the real
 *     mapping. STANDARD-as-default keeps the F4 board readable; the
 *     Power-vs-Standard-vs-Light split will be wrong until the join
 *     lands.
 *   - `mtdSpendUsd`, `lastActivityTs`, `idleDays` come from
 *     GatewayClient, not Cursor. The real client returns 0 / null /
 *     null and lets the consumer (e.g. F4 page) join gateway data in.
 *   - `listWaitlist()` returns `[]` because the waitlist is a WDTS
 *     dashboard concept, not a Cursor concept. The synthetic client
 *     materialises a waitlist from Prisma; the real client deliberately
 *     does not pretend Cursor's API has one.
 *
 * Refs: scoping §4 integration #4; SCIM 2.0 RFC 7644 §3.4.2.
 */

import { jsonGet, type Fetch } from "../_http";
import { IntegrationError } from "../errors";
import type {
  CursorClient,
  CursorSeat,
  CursorSubTier,
  CursorWaitlistEntry,
} from "./types";

type Env = {
  baseUrl: string;
  token: string;
};

function readEnv(env: Record<string, string | undefined> = process.env): Env {
  const baseUrl = env.CURSOR_SCIM_BASE_URL;
  const token = env.CURSOR_ADMIN_TOKEN;
  if (!baseUrl || !token) {
    throw new IntegrationError(
      "cursor",
      "CURSOR_SCIM_BASE_URL and CURSOR_ADMIN_TOKEN must be set when INTEGRATION_CURSOR=real.",
    );
  }
  return { baseUrl: baseUrl.replace(/\/$/, ""), token };
}

/** SCIM 2.0 User resource (subset). */
type ScimUser = {
  id: string;
  userName: string;
  displayName?: string;
  active: boolean;
  emails?: Array<{ value: string; primary?: boolean }>;
  name?: { givenName?: string; familyName?: string };
};

type ScimListResponse = {
  schemas: string[];
  totalResults: number;
  itemsPerPage: number;
  startIndex: number;
  Resources: ScimUser[];
};

function primaryEmail(u: ScimUser): string {
  if (u.emails && u.emails.length > 0) {
    const primary = u.emails.find((e) => e.primary) ?? u.emails[0];
    return primary.value;
  }
  return u.userName;
}

function displayNameOf(u: ScimUser): string {
  if (u.displayName) return u.displayName;
  if (u.name) {
    const composed = `${u.name.givenName ?? ""} ${u.name.familyName ?? ""}`.trim();
    if (composed) return composed;
  }
  return primaryEmail(u);
}

async function listScimUsers(env: Env, fetchImpl?: Fetch): Promise<ScimUser[]> {
  // SCIM 2.0 paginates with startIndex (1-based) + count. Run a hand-
  // rolled loop because the response field name is `Resources` (capital
  // R), which doesn't match the generic paginate() helper's shape.
  const out: ScimUser[] = [];
  let startIndex = 1;
  const count = 100;
  for (let i = 0; i < 50; i++) {
    const url = `${env.baseUrl}/Users?startIndex=${startIndex}&count=${count}`;
    const page = await jsonGet<ScimListResponse>(url, {
      integration: "cursor",
      fetchImpl,
      headers: {
        Authorization: `Bearer ${env.token}`,
        Accept: "application/scim+json",
      },
    });
    out.push(...page.Resources);
    if (page.Resources.length < count) break;
    startIndex += count;
    if (out.length >= page.totalResults) break;
  }
  return out;
}

export function makeRealCursorClient(opts?: {
  fetchImpl?: Fetch;
  env?: Record<string, string | undefined>;
}): CursorClient {
  return {
    async listSeats(): Promise<CursorSeat[]> {
      const env = readEnv(opts?.env);
      const users = await listScimUsers(env, opts?.fetchImpl);
      // TODO(v0.4): join policy-repo state to derive subTier per user.
      const defaultTier: CursorSubTier = "STANDARD";
      return users
        .filter((u) => u.active !== false)
        .map((u) => ({
          userId: u.id,
          email: primaryEmail(u),
          displayName: displayNameOf(u),
          subTier: defaultTier,
          lastActivityTs: null,
          idleDays: null,
          mtdSpendUsd: 0,
        }));
    },

    async listWaitlist(): Promise<CursorWaitlistEntry[]> {
      // Intentional: Cursor's API has no waitlist concept. This is a
      // dashboard/Prisma-managed queue; the synthetic client builds it
      // from local data, the real client returns empty. F4 callers that
      // want a real waitlist should call into Prisma directly.
      return [];
    },
  };
}

export const realCursorClient = makeRealCursorClient();
