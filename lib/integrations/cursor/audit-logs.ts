/**
 * Cursor Team Admin audit logs — login events carry `ip_address` per user.
 * @see https://cursor.com/docs/account/teams/admin-api#get-audit-logs
 *
 * Usage events (`filtered-usage-events`) do not expose IP in the published schema;
 * login audit logs are the supported way to see distinct sign-in IPs.
 */

import { getIntegrationMode, type IntegrationEnv } from "../env";
import { cursorTeamGetJson } from "./cursor-team-http";
import { resolveCursorTeamAdminApiKey } from "./team-admin-usage";

export type CursorAuditLogEvent = {
  event_id?: string;
  timestamp?: string;
  ip_address?: string;
  user_email?: string;
  event_type?: string;
};

type AuditLogsPage = {
  events?: CursorAuditLogEvent[];
  pagination?: {
    page?: number;
    pageSize?: number;
    hasNextPage?: boolean;
  };
};

const MAX_PAGES = 50;
const DEFAULT_LOOKBACK_DAYS = 30;

function normEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normIp(raw: string | undefined): string | null {
  const ip = raw?.trim();
  if (!ip) return null;
  return ip;
}

export type CursorLoginIpSummary =
  | {
      available: true;
      distinctIps: string[];
      loginEventCount: number;
      lookbackDays: number;
    }
  | {
      available: false;
      reason: string;
    };

/**
 * Distinct `ip_address` values from `login` audit events for one email (max 30d per request).
 */
export async function summarizeCursorLoginIpsForEmail(args: {
  email: string;
  lookbackDays?: number;
  env?: IntegrationEnv;
  fetchImpl?: typeof fetch;
}): Promise<CursorLoginIpSummary> {
  const env = args.env ?? process.env;
  if (getIntegrationMode("cursor", env) !== "real") {
    return { available: false, reason: "INTEGRATION_CURSOR is not real" };
  }
  const apiKey = resolveCursorTeamAdminApiKey(env);
  if (!apiKey) {
    return { available: false, reason: "Cursor Team Admin API key unset" };
  }

  const email = normEmail(args.email);
  if (!email.includes("@")) {
    return { available: false, reason: "Invalid email" };
  }

  const lookbackDays = Math.min(Math.max(args.lookbackDays ?? DEFAULT_LOOKBACK_DAYS, 1), 30);
  const ips = new Set<string>();
  let loginEventCount = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await cursorTeamGetJson<AuditLogsPage>({
      path: "/teams/audit-logs",
      query: {
        users: email,
        eventTypes: "login",
        startTime: `${lookbackDays}d`,
        endTime: "now",
        page,
        pageSize: 500,
      },
      apiKey,
      fetchImpl: args.fetchImpl,
      useEtagCache: false,
    });

    for (const ev of body.events ?? []) {
      if ((ev.event_type ?? "").toLowerCase() !== "login") continue;
      const evEmail = normEmail(ev.user_email ?? "");
      if (evEmail && evEmail !== email) continue;
      loginEventCount += 1;
      const ip = normIp(ev.ip_address);
      if (ip) ips.add(ip);
    }

    if (body.pagination?.hasNextPage !== true) break;
  }

  return {
    available: true,
    distinctIps: [...ips].sort(),
    loginEventCount,
    lookbackDays,
  };
}
