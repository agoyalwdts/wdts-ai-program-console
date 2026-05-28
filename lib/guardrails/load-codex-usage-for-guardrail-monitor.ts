/**
 * Feed guardrail monitor from Codex Enterprise Analytics per-user usage
 * when INTEGRATION_CODEX_ENTERPRISE_ANALYTICS=real (no gateway mirror required for Codex).
 */

import { getIntegrationMode, type IntegrationEnv } from "@/lib/integrations/env";
import {
  fetchCodexEnterprisePerUserUsageRows,
  resolveCodexEnterpriseAnalyticsCredentials,
  resolveUsdPerCredit,
} from "@/lib/integrations/codex-enterprise-analytics/fetch-workspace-usage";
import type { Fetch } from "@/lib/integrations/_http";
import { buildCodexAnalyticsUserEmailMap } from "./build-codex-user-email-map";
import {
  mapCodexUsageRowToGuardrailUsage,
  type CodexGuardrailMappedEntry,
} from "./map-codex-analytics-to-guardrail";

export type CodexGuardrailFeedResult =
  | {
      active: true;
      bucketsFetched: number;
      rowsInWindow: number;
      rows: CodexGuardrailMappedEntry[];
      emailsResolved: number;
      bucketsWithoutEmail: number;
    }
  | {
      active: false;
      bucketsFetched: 0;
      rowsInWindow: 0;
      rows: [];
      emailsResolved: 0;
      bucketsWithoutEmail: 0;
      reason: string;
    };

const DEFAULT_MAX_PAGES = 40;
const MIN_CODEX_GUARDRAIL_LOOKBACK_HOURS = 24;

export async function loadCodexUsageForGuardrailMonitor(args: {
  since: Date;
  env?: IntegrationEnv;
  fetchImpl?: Fetch;
  maxPages?: number;
}): Promise<CodexGuardrailFeedResult> {
  const env = args.env ?? process.env;
  const mode = getIntegrationMode("codexenterprise", env);
  if (mode !== "real") {
    return {
      active: false,
      bucketsFetched: 0,
      rowsInWindow: 0,
      rows: [],
      reason: "INTEGRATION_CODEX_ENTERPRISE_ANALYTICS is not real",
      emailsResolved: 0,
      bucketsWithoutEmail: 0,
    };
  }

  const creds = resolveCodexEnterpriseAnalyticsCredentials(env);
  if (!creds) {
    return {
      active: false,
      bucketsFetched: 0,
      rowsInWindow: 0,
      rows: [],
      emailsResolved: 0,
      bucketsWithoutEmail: 0,
      reason: "OPENAI_CODEX_ANALYTICS_API_KEY or CHATGPT_WORKSPACE_ID unset",
    };
  }

  const sinceMs = args.since.getTime();
  const effectiveSinceMs = Math.min(
    sinceMs,
    Date.now() - MIN_CODEX_GUARDRAIL_LOOKBACK_HOURS * 60 * 60 * 1000,
  );
  const endMs = Date.now();
  if (effectiveSinceMs >= endMs) {
    return {
      active: true,
      bucketsFetched: 0,
      rowsInWindow: 0,
      rows: [],
      emailsResolved: 0,
      bucketsWithoutEmail: 0,
    };
  }

  const startSec = Math.floor(effectiveSinceMs / 1000);
  const endSec = Math.floor(endMs / 1000);
  const usdPerCredit = resolveUsdPerCredit(env);
  const userIdToEmail = await buildCodexAnalyticsUserEmailMap(env);

  const buckets = await fetchCodexEnterprisePerUserUsageRows({
    startTimeSec: startSec,
    endTimeSec: endSec,
    creds,
    fetchImpl: args.fetchImpl,
    maxPages: args.maxPages ?? DEFAULT_MAX_PAGES,
  });

  const rows: CodexGuardrailMappedEntry[] = [];
  let bucketsWithoutEmail = 0;
  for (const bucket of buckets) {
    const hasEmail =
      Boolean(bucket.email?.includes("@")) ||
      Boolean(bucket.user_id && userIdToEmail.has(bucket.user_id.trim()));
    if (!hasEmail && (bucket.totals?.credits ?? 0) > 0) bucketsWithoutEmail += 1;

    const mapped = mapCodexUsageRowToGuardrailUsage({
      row: bucket,
      sinceMs: effectiveSinceMs,
      usdPerCredit,
      userIdToEmail,
    });
    if (mapped) rows.push(mapped);
  }

  return {
    active: true,
    bucketsFetched: buckets.length,
    rowsInWindow: rows.length,
    rows,
    emailsResolved: userIdToEmail.size,
    bucketsWithoutEmail,
  };
}
