/**
 * HTTP helpers for https://api.chatgpt.com/v1/compliance/{workspaces|organizations}/{id}/logs
 */

import { IntegrationError } from "../errors";
import type { ComplianceLogsListResponse } from "./types";

const API_BASE = "https://api.chatgpt.com/v1/compliance";

export type ComplianceCreds = {
  apiKey: string;
  principalId: string;
  scope: "workspaces" | "organizations";
};

export function resolveComplianceCredentials(
  env: Record<string, string | undefined> = process.env,
): ComplianceCreds | null {
  const apiKey = env.OPENAI_COMPLIANCE_API_KEY?.trim();
  const workspaceId =
    env.CHATGPT_WORKSPACE_ID?.trim() || env.OPENAI_CHATGPT_WORKSPACE_ID?.trim();
  if (!apiKey || !workspaceId) return null;
  const scope = workspaceId.startsWith("org-") ? "organizations" : "workspaces";
  return { apiKey, principalId: workspaceId, scope };
}

function authHeader(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

function complianceBase(creds: ComplianceCreds): string {
  return `${API_BASE}/${creds.scope}/${encodeURIComponent(creds.principalId)}`;
}

export async function listComplianceLogFiles(args: {
  creds: ComplianceCreds;
  eventType: string;
  after: string;
  limit: number;
  fetchImpl?: typeof fetch;
}): Promise<ComplianceLogsListResponse> {
  const f = args.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const q = new URLSearchParams({
    limit: String(args.limit),
    event_type: args.eventType,
    after: args.after,
  });
  const url = `${complianceBase(args.creds)}/logs?${q.toString()}`;
  const res = await f(url, { headers: authHeader(args.creds.apiKey) });
  const text = await res.text();
  if (!res.ok) {
    throw new IntegrationError(
      "openaicompliance",
      `GET compliance logs → ${res.status}: ${text.slice(0, 500)}`,
    );
  }
  try {
    return JSON.parse(text) as ComplianceLogsListResponse;
  } catch {
    throw new IntegrationError("openaicompliance", "compliance logs list: invalid JSON");
  }
}

export async function downloadComplianceLogFile(args: {
  creds: ComplianceCreds;
  logId: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const f = args.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const url = `${complianceBase(args.creds)}/logs/${encodeURIComponent(args.logId)}`;
  const res = await f(url, { headers: authHeader(args.creds.apiKey), redirect: "follow" });
  const text = await res.text();
  if (!res.ok) {
    throw new IntegrationError(
      "openaicompliance",
      `GET compliance log ${args.logId} → ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  return text;
}
