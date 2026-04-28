/**
 * Real DeelClient — calls Deel's HRIS REST API for employee + manager
 * data. Used when `INTEGRATION_DEEL=real` (see lib/integrations/env.ts).
 *
 * Endpoint:
 *   GET https://api.letsdeel.com/rest/v2/people
 *     ?limit=100&offset=<n>
 *
 * Auth:
 *   Authorization: Bearer <DEEL_API_TOKEN>
 *
 * Webhooks (separate concern, see app/api/webhooks/deel/route.ts):
 *   Deel signs every webhook with HMAC-SHA256 in `x-deel-signature`.
 *   The receiver verifies + dispatches; this client doesn't.
 *
 * Refs: scoping §4 integration #3.
 */

import { jsonGet, type Fetch } from "../_http";
import { IntegrationError } from "../errors";
import { mapDeelPersonToEmployee, type DeelPersonRaw } from "./mapping";
import type { DeelClient, DeelEmployee } from "./types";

const API_BASE = "https://api.letsdeel.com/rest/v2";

type Env = { token: string };

function readEnv(env: Record<string, string | undefined> = process.env): Env {
  const token = env.DEEL_API_TOKEN;
  if (!token) {
    throw new IntegrationError(
      "deel",
      "DEEL_API_TOKEN must be set when INTEGRATION_DEEL=real.",
    );
  }
  return { token };
}

type PeoplePage = {
  data: DeelPersonRaw[];
  // Deel uses meta.cursor or meta.next per docs version. We honour both.
  meta?: { cursor?: { next?: string }; next?: string };
};

async function listAllPeople(env: Env, fetchImpl?: Fetch): Promise<DeelPersonRaw[]> {
  const out: DeelPersonRaw[] = [];
  let url: string | null = `${API_BASE}/people?limit=100`;
  for (let i = 0; i < 50 && url; i++) {
    const page: PeoplePage = await jsonGet<PeoplePage>(url, {
      integration: "deel",
      fetchImpl,
      headers: { Authorization: `Bearer ${env.token}` },
    });
    out.push(...page.data);
    url = page.meta?.cursor?.next ?? page.meta?.next ?? null;
  }
  return out;
}

export function makeRealDeelClient(opts?: {
  fetchImpl?: Fetch;
  env?: Record<string, string | undefined>;
}): DeelClient {
  return {
    async listEmployees(): Promise<DeelEmployee[]> {
      const env = readEnv(opts?.env);
      const raw = await listAllPeople(env, opts?.fetchImpl);
      return raw.map(mapDeelPersonToEmployee);
    },

    async getEmployeeByEmail(email: string): Promise<DeelEmployee | null> {
      if (!email) return null;
      const env = readEnv(opts?.env);
      const url = `${API_BASE}/people?email=${encodeURIComponent(email)}&limit=1`;
      const page = await jsonGet<PeoplePage>(url, {
        integration: "deel",
        fetchImpl: opts?.fetchImpl,
        headers: { Authorization: `Bearer ${env.token}` },
      });
      const first = page.data[0];
      return first ? mapDeelPersonToEmployee(first) : null;
    },
  };
}

export const realDeelClient = makeRealDeelClient();
