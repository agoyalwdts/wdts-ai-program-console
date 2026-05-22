/**
 * Per-user distinct Codex `client_id` values from Enterprise Analytics usage rows.
 * This is not IP / machine count — OpenAI's published Analytics API does not expose IP.
 */

import { getIntegrationMode, type IntegrationEnv } from "../env";
import {
  fetchCodexEnterprisePerUserUsageRows,
  resolveCodexEnterpriseAnalyticsCredentials,
} from "./fetch-workspace-usage";
import { normCodexAnalyticsEmail, resolveCodexUsageRowEmail } from "./aggregate-per-user-mtd";
import type { Fetch } from "../_http";

const DEFAULT_LOOKBACK_DAYS = 30;

export type CodexClientFootprintSummary =
  | {
      available: true;
      distinctClients: string[];
      lookbackDays: number;
      ipNote: string;
    }
  | {
      available: false;
      reason: string;
    };

export async function summarizeCodexClientsForEmail(args: {
  email: string;
  lookbackDays?: number;
  env?: IntegrationEnv;
  fetchImpl?: Fetch;
  now?: Date;
}): Promise<CodexClientFootprintSummary> {
  const env = args.env ?? process.env;
  if (getIntegrationMode("codexenterprise", env) !== "real") {
    return { available: false, reason: "INTEGRATION_CODEX_ENTERPRISE_ANALYTICS is not real" };
  }
  const creds = resolveCodexEnterpriseAnalyticsCredentials(env);
  if (!creds) {
    return {
      available: false,
      reason: "Codex analytics API key or CHATGPT_WORKSPACE_ID unset",
    };
  }

  const target = normCodexAnalyticsEmail(args.email);
  if (!target.includes("@")) {
    return { available: false, reason: "Invalid email" };
  }

  const lookbackDays = Math.min(Math.max(args.lookbackDays ?? DEFAULT_LOOKBACK_DAYS, 1), 90);
  const now = args.now ?? new Date();
  const endSec = Math.floor(now.getTime() / 1000);
  const startSec = endSec - lookbackDays * 86_400;

  const rows = await fetchCodexEnterprisePerUserUsageRows({
    startTimeSec: startSec,
    endTimeSec: endSec,
    creds,
    fetchImpl: args.fetchImpl,
  });

  const clients = new Set<string>();
  for (const row of rows) {
    const rowEmail = resolveCodexUsageRowEmail(row);
    if (!rowEmail || normCodexAnalyticsEmail(rowEmail) !== target) continue;
    for (const c of row.clients ?? []) {
      const id = c.client_id?.trim();
      if (id) clients.add(id);
    }
  }

  return {
    available: true,
    distinctClients: [...clients].sort(),
    lookbackDays,
    ipNote:
      "Codex Enterprise Analytics does not publish per-user IP addresses. Distinct client_id values (CLI, web, etc.) are shown instead. For IP-level audit, use OpenAI Compliance logs (not wired in this dashboard).",
  };
}
