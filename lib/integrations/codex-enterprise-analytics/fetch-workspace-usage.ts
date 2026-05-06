/**
 * Fetch workspace-aggregated daily Codex usage from ChatGPT Enterprise Analytics.
 *
 * Auth: Bearer token (Platform API key with codex.enterprise.analytics.read scope).
 * Base: https://api.chatgpt.com
 */

import { jsonGet, type Fetch } from "../_http";
import { IntegrationError } from "../errors";
import type { CodexUsagePage, CodexUsageRow } from "./types";
import { OPENAI_CREDIT_OVERAGE_USD } from "@/lib/program";

export const CODEX_ENTERPRISE_ANALYTICS_VENDOR_KEY =
  "OPENAI_CODEX_ENTERPRISE_ANALYTICS" as const;

const API_BASE = "https://api.chatgpt.com";

export type CodexEnterpriseAnalyticsEnv = {
  apiKey: string;
  workspaceId: string;
};

export function resolveCodexEnterpriseAnalyticsCredentials(
  env: Record<string, string | undefined> = process.env,
): CodexEnterpriseAnalyticsEnv | null {
  const apiKey = env.OPENAI_CODEX_ANALYTICS_API_KEY?.trim();
  const workspaceId =
    env.CHATGPT_WORKSPACE_ID?.trim() || env.OPENAI_CHATGPT_WORKSPACE_ID?.trim();
  if (!apiKey || !workspaceId) return null;
  return { apiKey, workspaceId };
}

function authHeader(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
  };
}

/**
 * All workspace-level daily rows in [startTimeSec, endTimeSec) (end exclusive, UTC).
 * Uses group=workspace and cursor pagination.
 */
export async function fetchCodexEnterpriseWorkspaceUsageRows(args: {
  startTimeSec: number;
  endTimeSec: number;
  creds: CodexEnterpriseAnalyticsEnv;
  fetchImpl?: Fetch;
  maxPages?: number;
}): Promise<CodexUsageRow[]> {
  const { creds, startTimeSec, endTimeSec } = args;
  const f = args.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const maxPages = args.maxPages ?? 50;

  const out: CodexUsageRow[] = [];
  let pageCursor: string | null | undefined = undefined;
  let stoppedWithMore = false;

  for (let i = 0; i < maxPages; i++) {
    const path = `/v1/analytics/codex/workspaces/${encodeURIComponent(creds.workspaceId)}/usage`;
    const q = new URLSearchParams();
    q.set("start_time", String(startTimeSec));
    q.set("end_time", String(endTimeSec));
    q.set("group", "workspace");
    q.set("limit", "1000");
    if (pageCursor) q.set("page", pageCursor);

    const url = `${API_BASE}${path}?${q.toString()}`;
    const body = await jsonGet<CodexUsagePage>(url, {
      integration: "codexenterprise",
      headers: authHeader(creds.apiKey),
      fetchImpl: f,
    });
    out.push(...(body.data ?? []));
    const more = body.has_more === true;
    const next = body.next_page ?? null;
    if (!more || next == null || next === "") {
      stoppedWithMore = false;
      break;
    }
    pageCursor = next;
    stoppedWithMore = true;
  }

  if (stoppedWithMore) {
    throw new IntegrationError(
      "codexenterprise",
      `Codex analytics usage: exceeded maxPages=${maxPages} (pagination not exhausted).`,
    );
  }

  return out;
}

/** USD per credit from env; defaults to contract overage rate (0.04). */
export function resolveUsdPerCredit(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.OPENAI_CODEX_ANALYTICS_USD_PER_CREDIT?.trim();
  if (!raw) return OPENAI_CREDIT_OVERAGE_USD;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new IntegrationError(
      "codexenterprise",
      "OPENAI_CODEX_ANALYTICS_USD_PER_CREDIT must be a non-negative number.",
    );
  }
  return n;
}
