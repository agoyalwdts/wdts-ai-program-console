import { getIntegrationMode, type IntegrationEnv } from "../env";
import {
  downloadComplianceLogFile,
  listComplianceLogFiles,
  resolveComplianceCredentials,
} from "./fetch";
import { extractAuthEventsFromLogBody } from "./parse-auth-log";
import type { ComplianceAuthLogIpSummary } from "./types";

const DEFAULT_LOOKBACK_DAYS = 30;
const LIST_LIMIT = 100;
const MAX_LIST_PAGES = 8;
const MAX_LOG_FILES_PER_USER = 12;

export async function summarizeComplianceAuthLogIpsForEmail(args: {
  email: string;
  lookbackDays?: number;
  env?: IntegrationEnv;
  fetchImpl?: typeof fetch;
}): Promise<ComplianceAuthLogIpSummary> {
  const env = args.env ?? process.env;
  if (getIntegrationMode("openaicompliance", env) !== "real") {
    return { available: false, reason: "INTEGRATION_OPENAI_COMPLIANCE is not real" };
  }

  const creds = resolveComplianceCredentials(env);
  if (!creds) {
    return {
      available: false,
      reason: "OPENAI_COMPLIANCE_API_KEY or CHATGPT_WORKSPACE_ID unset",
    };
  }

  const email = args.email.trim().toLowerCase();
  if (!email.includes("@")) {
    return { available: false, reason: "Invalid email" };
  }

  const lookbackDays = Math.min(Math.max(args.lookbackDays ?? DEFAULT_LOOKBACK_DAYS, 1), 30);
  const after = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();

  const ips = new Set<string>();
  let authEventCount = 0;
  let logFilesScanned = 0;
  let cursor = after;

  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const list = await listComplianceLogFiles({
      creds,
      eventType: "AUTH_LOG",
      after: cursor,
      limit: LIST_LIMIT,
      fetchImpl: args.fetchImpl,
    });
    const ids = (list.data ?? []).map((d) => d.id).filter(Boolean);
    if (ids.length === 0 && page === 0) {
      return {
        available: true,
        distinctIps: [],
        authEventCount: 0,
        lookbackDays,
        logFilesScanned: 0,
      };
    }

    for (const id of ids) {
      if (logFilesScanned >= MAX_LOG_FILES_PER_USER) break;
      logFilesScanned += 1;
      const body = await downloadComplianceLogFile({
        creds,
        logId: id,
        fetchImpl: args.fetchImpl,
      });
      const hit = extractAuthEventsFromLogBody(body, email);
      authEventCount += hit.eventCount;
      for (const ip of hit.ips) ips.add(ip);
    }

    if (logFilesScanned >= MAX_LOG_FILES_PER_USER) break;
    if (list.has_more !== true || !list.last_end_time) break;
    cursor = list.last_end_time;
  }

  return {
    available: true,
    distinctIps: [...ips].sort(),
    authEventCount,
    lookbackDays,
    logFilesScanned,
  };
}
