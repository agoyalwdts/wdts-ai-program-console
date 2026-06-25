/**
 * OpenAI Organization Admin audit logs — configuration and login events.
 * GET https://api.openai.com/v1/organization/audit_logs
 */

import { jsonGet, type Fetch } from "../_http";
import { IntegrationError } from "../errors";
import { resolveOpenAiCostsCredentials, type OpenAiCostsEnv } from "./org-costs";

const AUDIT_LOGS_PATH = "https://api.openai.com/v1/organization/audit_logs";

export type OpenAiAuditLogEvent = {
  id: string;
  type: string;
  effective_at?: number;
  actor?: { type?: string; email?: string; id?: string };
  ip_address?: string;
  user_agent?: string;
  raw: Record<string, unknown>;
};

export type OpenAiAuditLogListResponse = {
  data?: OpenAiAuditLogEvent[];
  has_more?: boolean;
  last_id?: string | null;
};

function authHeaders(creds: OpenAiCostsEnv): Record<string, string> {
  return {
    Authorization: `Bearer ${creds.apiKey}`,
    "OpenAI-Organization": creds.orgId,
  };
}

function normalizeEvent(raw: Record<string, unknown>): OpenAiAuditLogEvent | null {
  const id = typeof raw.id === "string" ? raw.id : null;
  const type = typeof raw.type === "string" ? raw.type : null;
  if (!id || !type) return null;
  const actor =
    raw.actor && typeof raw.actor === "object"
      ? (raw.actor as OpenAiAuditLogEvent["actor"])
      : undefined;
  return {
    id,
    type,
    effective_at: typeof raw.effective_at === "number" ? raw.effective_at : undefined,
    actor,
    ip_address: typeof raw.ip_address === "string" ? raw.ip_address : undefined,
    user_agent: typeof raw.user_agent === "string" ? raw.user_agent : undefined,
    raw,
  };
}

export async function listOpenAiAuditLogs(args: {
  creds: OpenAiCostsEnv;
  limit?: number;
  after?: string;
  effectiveAtGte?: number;
  fetchImpl?: Fetch;
}): Promise<OpenAiAuditLogListResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(Math.min(Math.max(args.limit ?? 50, 1), 100)));
  if (args.after) params.set("after", args.after);
  if (args.effectiveAtGte != null) {
    params.set("effective_at[gte]", String(args.effectiveAtGte));
  }

  const url = `${AUDIT_LOGS_PATH}?${params.toString()}`;
  const res = await jsonGet<Record<string, unknown>>(url, {
    headers: authHeaders(args.creds),
    fetchImpl: args.fetchImpl,
    integration: "openai",
  });

  const data = Array.isArray(res.data)
    ? res.data
        .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
        .map(normalizeEvent)
        .filter((e): e is OpenAiAuditLogEvent => e != null)
    : [];

  return {
    data,
    has_more: res.has_more === true,
    last_id: typeof res.last_id === "string" ? res.last_id : null,
  };
}

export async function fetchOpenAiAuditLogsSince(args: {
  env?: Record<string, string | undefined>;
  effectiveAtGte?: number;
  maxPages?: number;
  fetchImpl?: Fetch;
}): Promise<OpenAiAuditLogEvent[]> {
  const creds = resolveOpenAiCostsCredentials(args.env);
  if (!creds) {
    throw new IntegrationError(
      "openai",
      "OPENAI_ADMIN_API_KEY and OPENAI_ORG_ID must be set when INTEGRATION_OPENAI=real.",
    );
  }

  const events: OpenAiAuditLogEvent[] = [];
  let after: string | undefined;
  const maxPages = Math.min(Math.max(args.maxPages ?? 5, 1), 20);

  for (let page = 0; page < maxPages; page++) {
    const pageRes = await listOpenAiAuditLogs({
      creds,
      after,
      effectiveAtGte: args.effectiveAtGte,
      fetchImpl: args.fetchImpl,
    });
    if (pageRes.data?.length) events.push(...pageRes.data);
    if (pageRes.has_more !== true || !pageRes.last_id) break;
    after = pageRes.last_id;
  }

  return events;
}
