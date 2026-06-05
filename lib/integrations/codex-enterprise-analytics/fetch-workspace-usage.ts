/**
 * Fetch workspace-aggregated daily Codex usage from ChatGPT Enterprise Analytics.
 *
 * Auth: Bearer token (Platform API key with codex.enterprise.analytics.read scope).
 * Base: https://api.chatgpt.com
 */

import type { Fetch } from "../_http";
import { IntegrationError } from "../errors";
import { fetchCodexEnterpriseAnalyticsPages } from "./fetch-paginated";
import type { CodexCodeReviewResponseRow, CodexReviewsRow, CodexUsageRow } from "./types";
import { OPENAI_CREDIT_OVERAGE_USD } from "@/lib/program";

export const CODEX_ENTERPRISE_ANALYTICS_VENDOR_KEY =
  "OPENAI_CODEX_ENTERPRISE_ANALYTICS" as const;

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

export function authHeader(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
  };
}

export type CodexUsageGroup = "workspace" | "user";

/**
 * Paginated usage rows in [startTimeSec, endTimeSec) (end exclusive, UTC).
 * Omit `group` (or pass `user`) for per-user daily buckets; `workspace` for totals.
 */
export async function fetchCodexEnterpriseUsageRows(args: {
  startTimeSec: number;
  endTimeSec: number;
  creds: CodexEnterpriseAnalyticsEnv;
  group?: CodexUsageGroup;
  fetchImpl?: Fetch;
  maxPages?: number;
}): Promise<CodexUsageRow[]> {
  return fetchCodexEnterpriseAnalyticsPages<CodexUsageRow>({
    pathSuffix: "usage",
    startTimeSec: args.startTimeSec,
    endTimeSec: args.endTimeSec,
    creds: args.creds,
    fetchImpl: args.fetchImpl,
    maxPages: args.maxPages,
    group: args.group === "workspace" ? "workspace" : undefined,
  });
}

export async function fetchCodexEnterpriseWorkspaceUsageRows(args: {
  startTimeSec: number;
  endTimeSec: number;
  creds: CodexEnterpriseAnalyticsEnv;
  fetchImpl?: Fetch;
  maxPages?: number;
}): Promise<CodexUsageRow[]> {
  return fetchCodexEnterpriseUsageRows({ ...args, group: "workspace" });
}

export async function fetchCodexEnterprisePerUserUsageRows(args: {
  startTimeSec: number;
  endTimeSec: number;
  creds: CodexEnterpriseAnalyticsEnv;
  fetchImpl?: Fetch;
  maxPages?: number;
}): Promise<CodexUsageRow[]> {
  return fetchCodexEnterpriseUsageRows({ ...args, group: "user" });
}

export async function fetchCodexEnterpriseCodeReviewRows(args: {
  startTimeSec: number;
  endTimeSec: number;
  creds: CodexEnterpriseAnalyticsEnv;
  fetchImpl?: Fetch;
  maxPages?: number;
}): Promise<CodexReviewsRow[]> {
  return fetchCodexEnterpriseAnalyticsPages<CodexReviewsRow>({
    pathSuffix: "code_reviews",
    ...args,
  });
}

export async function fetchCodexEnterpriseCodeReviewResponseRows(args: {
  startTimeSec: number;
  endTimeSec: number;
  creds: CodexEnterpriseAnalyticsEnv;
  fetchImpl?: Fetch;
  maxPages?: number;
}): Promise<CodexCodeReviewResponseRow[]> {
  return fetchCodexEnterpriseAnalyticsPages<CodexCodeReviewResponseRow>({
    pathSuffix: "code_review_responses",
    ...args,
  });
}

/** USD per credit from env; defaults to {@link OPENAI_CREDIT_OVERAGE_USD} (contract overage). */
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
