/**
 * Shared cursor pagination for Codex Enterprise Analytics GET endpoints.
 */

import { jsonGet, type Fetch } from "../_http";
import { IntegrationError } from "../errors";
import type { CodexAnalyticsPage } from "./types";
import {
  authHeader,
  type CodexEnterpriseAnalyticsEnv,
} from "./fetch-workspace-usage";

const API_BASE = "https://api.chatgpt.com";

export async function fetchCodexEnterpriseAnalyticsPages<T>(args: {
  pathSuffix: "usage" | "code_reviews" | "code_review_responses";
  startTimeSec: number;
  endTimeSec: number;
  creds: CodexEnterpriseAnalyticsEnv;
  fetchImpl?: Fetch;
  maxPages?: number;
  /** usage only — `workspace` for aggregates; omit for per-user. */
  group?: "workspace";
}): Promise<T[]> {
  const f = args.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const maxPages = args.maxPages ?? 50;
  const out: T[] = [];
  let pageCursor: string | null | undefined = undefined;
  let stoppedWithMore = false;

  for (let i = 0; i < maxPages; i++) {
    const path = `/v1/analytics/codex/workspaces/${encodeURIComponent(args.creds.workspaceId)}/${args.pathSuffix}`;
    const q = new URLSearchParams();
    q.set("start_time", String(args.startTimeSec));
    q.set("end_time", String(args.endTimeSec));
    if (args.pathSuffix === "usage" && args.group === "workspace") {
      q.set("group", "workspace");
    }
    q.set("limit", "1000");
    if (pageCursor) q.set("page", pageCursor);

    const url = `${API_BASE}${path}?${q.toString()}`;
    const body = await jsonGet<CodexAnalyticsPage<T>>(url, {
      integration: "codexenterprise",
      headers: authHeader(args.creds.apiKey),
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
      `Codex analytics ${args.pathSuffix}: exceeded maxPages=${maxPages} (pagination not exhausted).`,
    );
  }

  return out;
}
