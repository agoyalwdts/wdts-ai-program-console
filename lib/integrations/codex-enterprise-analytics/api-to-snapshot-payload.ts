/**
 * Map Codex Enterprise Analytics API rows → ProgramVendorExportSnapshot payloads
 * (same shapes as manual JSON imports for Analytics charts).
 */

import { utcYmdFromUnixSec } from "./aggregate-workspace-daily";
import { normCodexAnalyticsEmail } from "./aggregate-per-user-mtd";
import {
  aggregateUserPostureFromBuckets,
  buildUsageBucketsFromRows,
} from "@/lib/analytics/codex-usage-posture";
import type {
  CodexCodeReviewResponseRow,
  CodexReviewsRow,
  CodexUsageRow,
} from "./types";

export function workspaceUsageRowsToSnapshotPayload(rows: CodexUsageRow[]): {
  days: {
    date: string;
    credits: number;
    users: number;
    threads: number;
    turns: number;
    clients: { client_id: string; credits: number; users: number }[];
  }[];
  source: "codex_enterprise_analytics_api";
} {
  const days = rows
    .map((r) => {
      const date = utcYmdFromUnixSec(r.start_time);
      const credits = r.totals?.credits ?? 0;
      const threads = r.totals?.threads ?? 0;
      const turns = r.totals?.turns ?? 0;
      const clients = (r.clients ?? [])
        .map((c) => {
          const client_id = c.client_id?.trim() ?? "";
          if (!client_id) return null;
          return {
            client_id,
            credits: c.credits ?? 0,
            users: 0,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x != null);
      return { date, credits, users: 0, threads, turns, clients };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  return { days, source: "codex_enterprise_analytics_api" };
}

export function perUserUsageRowsToSessionsSnapshotPayload(
  rows: CodexUsageRow[],
  userIdToEmail?: ReadonlyMap<string, string>,
): {
  creditsByDate: Record<string, number>;
  users: {
    email: string;
    credits_used: number;
    top_model: string | null;
    top_model_credits: number;
    lines_added: number;
    lines_removed: number;
  }[];
  usageBuckets: ReturnType<typeof buildUsageBucketsFromRows>;
  userCount: number;
  rowCount: number;
  source: "codex_enterprise_analytics_api";
} {
  const usageBuckets = buildUsageBucketsFromRows(rows, userIdToEmail);
  const creditsByDate: Record<string, number> = {};
  let rowCount = 0;

  for (const row of rows) {
    const credits = row.totals?.credits ?? 0;
    if (credits <= 0) continue;
    rowCount += 1;
    const date = utcYmdFromUnixSec(row.start_time);
    creditsByDate[date] = (creditsByDate[date] ?? 0) + credits;
  }

  const users = aggregateUserPostureFromBuckets(usageBuckets).map((u) => ({
    email: u.email,
    credits_used: u.credits_used,
    top_model: u.top_model,
    top_model_credits: u.top_model_credits,
    lines_added: u.lines_added,
    lines_removed: u.lines_removed,
  }));

  return {
    creditsByDate,
    users,
    usageBuckets,
    userCount: users.length,
    rowCount,
    source: "codex_enterprise_analytics_api",
  };
}

export function codeReviewRowsToSnapshotPayload(rows: CodexReviewsRow[]): {
  days: {
    date: string;
    n_reviews: number;
    n_comments: number;
    comments_per_review: number;
    severity?: { p0: number; p1: number; p2: number };
  }[];
  source: "codex_enterprise_analytics_api";
} {
  const days = rows
    .map((r) => {
      const date = utcYmdFromUnixSec(r.start_time);
      const n_reviews = r.pull_request_reviews ?? 0;
      const n_comments = r.comments ?? 0;
      const comments_per_review = n_reviews > 0 ? n_comments / n_reviews : 0;
      const sev = r.comment_details;
      return {
        date,
        n_reviews,
        n_comments,
        comments_per_review,
        ...(sev ? { severity: { p0: sev.p0, p1: sev.p1, p2: sev.p2 } } : {}),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  return { days, source: "codex_enterprise_analytics_api" };
}

export function codeReviewResponseRowsToSnapshotPayload(rows: CodexCodeReviewResponseRow[]): {
  days: {
    date: string;
    pull_request_reviews: number;
    comments: number;
    replies: number;
    reactions: number;
    engaged?: number;
    upvoted?: number;
    downvoted?: number;
  }[];
  source: "codex_enterprise_analytics_api";
} {
  const days = rows
    .map((r) => {
      const date = utcYmdFromUnixSec(r.start_time);
      const d = r.comment_response_details;
      return {
        date,
        pull_request_reviews: r.pull_request_reviews ?? 0,
        comments: r.comments ?? 0,
        replies: r.replies ?? 0,
        reactions: r.reactions ?? 0,
        engaged: d?.engaged,
        upvoted: d?.upvoted,
        downvoted: d?.downvoted,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  return { days, source: "codex_enterprise_analytics_api" };
}

/** Summarize per-model credits across per-user rows (Analytics / guardrail context). */
export function aggregateModelCreditsFromUsageRows(
  rows: CodexUsageRow[],
): { model: string; credits: number }[] {
  const byModel = new Map<string, number>();
  for (const row of rows) {
    for (const m of row.models ?? []) {
      if (!m.model || typeof m.credits !== "number") continue;
      byModel.set(m.model, (byModel.get(m.model) ?? 0) + m.credits);
    }
  }
  return [...byModel.entries()]
    .map(([model, credits]) => ({ model, credits }))
    .sort((a, b) => b.credits - a.credits);
}

export function normEmailForMap(email: string): string {
  return normCodexAnalyticsEmail(email);
}
