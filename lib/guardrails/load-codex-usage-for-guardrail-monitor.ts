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
import { mapCodexUsageRowToGuardrailUsage } from "./map-codex-analytics-to-guardrail";
import type { GuardrailMonitorUsageRow } from "./load-cursor-usage-for-monitor";

export type CodexGuardrailFeedResult =
  | {
      active: true;
      bucketsFetched: number;
      rowsInWindow: number;
      rows: GuardrailMonitorUsageRow[];
    }
  | {
      active: false;
      bucketsFetched: 0;
      rowsInWindow: 0;
      rows: [];
      reason: string;
    };

const DEFAULT_MAX_PAGES = 40;

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
    };
  }

  const creds = resolveCodexEnterpriseAnalyticsCredentials(env);
  if (!creds) {
    return {
      active: false,
      bucketsFetched: 0,
      rowsInWindow: 0,
      rows: [],
      reason: "OPENAI_CODEX_ANALYTICS_API_KEY or CHATGPT_WORKSPACE_ID unset",
    };
  }

  const sinceMs = args.since.getTime();
  const endMs = Date.now();
  if (sinceMs >= endMs) {
    return { active: true, bucketsFetched: 0, rowsInWindow: 0, rows: [] };
  }

  const startSec = Math.floor(sinceMs / 1000);
  const endSec = Math.floor(endMs / 1000);
  const usdPerCredit = resolveUsdPerCredit(env);

  const buckets = await fetchCodexEnterprisePerUserUsageRows({
    startTimeSec: startSec,
    endTimeSec: endSec,
    creds,
    fetchImpl: args.fetchImpl,
    maxPages: args.maxPages ?? DEFAULT_MAX_PAGES,
  });

  const rows: GuardrailMonitorUsageRow[] = [];
  for (const bucket of buckets) {
    const mapped = mapCodexUsageRowToGuardrailUsage({
      row: bucket,
      sinceMs,
      usdPerCredit,
    });
    if (mapped) rows.push(mapped);
  }

  return {
    active: true,
    bucketsFetched: buckets.length,
    rowsInWindow: rows.length,
    rows,
  };
}
