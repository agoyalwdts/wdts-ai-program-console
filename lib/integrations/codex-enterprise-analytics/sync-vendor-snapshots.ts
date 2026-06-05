/**
 * Pull Codex Enterprise Analytics API → ProgramVendorExportSnapshot rows
 * (workspace usage, per-user sessions, code reviews, review responses).
 */

import type { PrismaClient } from "@prisma/client";
import { calendarDayAtNoonFromYmd } from "@/lib/imports/program-vendor-export/dates";
import { buildCodexAnalyticsUserEmailMap } from "@/lib/guardrails/build-codex-user-email-map";
import {
  codeReviewResponseRowsToSnapshotPayload,
  codeReviewRowsToSnapshotPayload,
  perUserUsageRowsToSessionsSnapshotPayload,
  workspaceUsageRowsToSnapshotPayload,
} from "./api-to-snapshot-payload";
import {
  fetchCodexEnterpriseCodeReviewResponseRows,
  fetchCodexEnterpriseCodeReviewRows,
  fetchCodexEnterprisePerUserUsageRows,
  fetchCodexEnterpriseWorkspaceUsageRows,
  resolveCodexEnterpriseAnalyticsCredentials,
} from "./fetch-workspace-usage";

export type CodexEnterpriseSnapshotSyncResult = {
  snapshotsWritten: number;
  kinds: string[];
  workspaceDays: number;
  sessionUserCount: number;
  codeReviewDays: number;
  codeReviewResponseDays: number;
  windowStartMs: number;
  windowEndMs: number;
};

function periodFromYmds(dates: string[]): { start: Date | null; end: Date | null } {
  if (dates.length === 0) return { start: null, end: null };
  const sorted = [...dates].sort();
  return {
    start: calendarDayAtNoonFromYmd(sorted[0]!),
    end: calendarDayAtNoonFromYmd(sorted[sorted.length - 1]!),
  };
}

export async function syncCodexEnterpriseAnalyticsSnapshots(
  prisma: PrismaClient,
  args: {
    lookbackDays: number;
    actorEmail: string;
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
  },
): Promise<CodexEnterpriseSnapshotSyncResult> {
  const env = args.env ?? process.env;
  const creds = resolveCodexEnterpriseAnalyticsCredentials(env);
  if (!creds) {
    throw new Error(
      "OPENAI_CODEX_ANALYTICS_API_KEY and CHATGPT_WORKSPACE_ID must be set for Codex analytics snapshots.",
    );
  }

  const lookbackDays = Math.min(Math.max(args.lookbackDays, 1), 400);
  const endMs = Date.now();
  const startMs = endMs - lookbackDays * 24 * 60 * 60 * 1000;
  const startTimeSec = Math.floor(startMs / 1000);
  const endTimeSec = Math.floor(endMs / 1000);

  const userIdToEmail = await buildCodexAnalyticsUserEmailMap({ env, prisma });

  const [workspaceRows, userRows, reviewRows, responseRows] = await Promise.all([
    fetchCodexEnterpriseWorkspaceUsageRows({
      startTimeSec,
      endTimeSec,
      creds,
      fetchImpl: args.fetchImpl,
    }),
    fetchCodexEnterprisePerUserUsageRows({
      startTimeSec,
      endTimeSec,
      creds,
      fetchImpl: args.fetchImpl,
    }),
    fetchCodexEnterpriseCodeReviewRows({
      startTimeSec,
      endTimeSec,
      creds,
      fetchImpl: args.fetchImpl,
    }),
    fetchCodexEnterpriseCodeReviewResponseRows({
      startTimeSec,
      endTimeSec,
      creds,
      fetchImpl: args.fetchImpl,
    }),
  ]);

  const kinds: string[] = [];
  let snapshotsWritten = 0;

  if (workspaceRows.length > 0) {
    const payload = workspaceUsageRowsToSnapshotPayload(workspaceRows);
    const dates = payload.days.map((d) => d.date);
    const { start, end } = periodFromYmds(dates);
    await prisma.programVendorExportSnapshot.create({
      data: {
        kind: "CODEX_WORKSPACE_JSON",
        filename: "codex-analytics-api-workspace.json",
        periodStart: start,
        periodEnd: end,
        rowCount: payload.days.length,
        actorEmail: args.actorEmail,
        payload,
      },
    });
    kinds.push("CODEX_WORKSPACE_JSON");
    snapshotsWritten += 1;
  }

  if (userRows.length > 0) {
    const payload = perUserUsageRowsToSessionsSnapshotPayload(userRows, userIdToEmail);
    const dates = Object.keys(payload.creditsByDate);
    const { start, end } = periodFromYmds(dates);
    await prisma.programVendorExportSnapshot.create({
      data: {
        kind: "CODEX_SESSIONS_JSON",
        filename: "codex-analytics-api-sessions.json",
        periodStart: start,
        periodEnd: end,
        rowCount: payload.rowCount,
        actorEmail: args.actorEmail,
        payload,
      },
    });
    kinds.push("CODEX_SESSIONS_JSON");
    snapshotsWritten += 1;
  }

  if (reviewRows.length > 0) {
    const payload = codeReviewRowsToSnapshotPayload(reviewRows);
    const dates = payload.days.map((d) => d.date);
    const { start, end } = periodFromYmds(dates);
    await prisma.programVendorExportSnapshot.create({
      data: {
        kind: "CODEX_CODE_REVIEW_JSON",
        filename: "codex-analytics-api-code-reviews.json",
        periodStart: start,
        periodEnd: end,
        rowCount: payload.days.length,
        actorEmail: args.actorEmail,
        payload,
      },
    });
    kinds.push("CODEX_CODE_REVIEW_JSON");
    snapshotsWritten += 1;
  }

  if (responseRows.length > 0) {
    const payload = codeReviewResponseRowsToSnapshotPayload(responseRows);
    const dates = payload.days.map((d) => d.date);
    const { start, end } = periodFromYmds(dates);
    await prisma.programVendorExportSnapshot.create({
      data: {
        kind: "CODEX_CODE_REVIEW_RESPONSES_JSON",
        filename: "codex-analytics-api-code-review-responses.json",
        periodStart: start,
        periodEnd: end,
        rowCount: payload.days.length,
        actorEmail: args.actorEmail,
        payload,
      },
    });
    kinds.push("CODEX_CODE_REVIEW_RESPONSES_JSON");
    snapshotsWritten += 1;
  }

  return {
    snapshotsWritten,
    kinds,
    workspaceDays: workspaceRows.length,
    sessionUserCount: perUserUsageRowsToSessionsSnapshotPayload(userRows, userIdToEmail)
      .userCount,
    codeReviewDays: reviewRows.length,
    codeReviewResponseDays: responseRows.length,
    windowStartMs: startMs,
    windowEndMs: endMs,
  };
}
