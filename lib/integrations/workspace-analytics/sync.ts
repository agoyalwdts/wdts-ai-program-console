/**
 * Incremental Workspace Analytics sync (Compliance Logs Platform, all four event types).
 */

import { DecisionType, type PrismaClient } from "@prisma/client";
import { getIntegrationMode, type IntegrationEnv } from "../env";
import {
  downloadComplianceLogFile,
  listComplianceLogFiles,
  resolveComplianceCredentials,
} from "../openai-compliance/fetch";
import type { WorkspaceAnalyticsEventType } from "./event-types";
import { WORKSPACE_ANALYTICS_EVENT_TYPES } from "./event-types";
import {
  ingestGptAnalyticsRows,
  ingestProjectAnalyticsRows,
  ingestSurveyAnalyticsRows,
  ingestUserAnalyticsRows,
} from "./ingest";
import { mapEnvelopeForEventType, parseWorkspaceAnalyticsJsonl } from "./parse-jsonl";
import {
  hasSeenEventId,
  hasSeenLogFileId,
  loadWorkspaceAnalyticsSyncState,
  rememberEventId,
  rememberLogFileId,
  saveWorkspaceAnalyticsSyncState,
  trimSyncState,
} from "./sync-state";
import type {
  ChatgptGptAnalyticsRow,
  ChatgptProjectAnalyticsRow,
  ChatgptSurveyAnalyticsRow,
  ChatgptUserAnalyticsRow,
  WorkspaceAnalyticsSyncEventSummary,
  WorkspaceAnalyticsSyncResult,
  WorkspaceAnalyticsSyncState,
} from "./types";

const LIST_LIMIT = 100;
const MAX_LIST_PAGES = 20;
const MAX_FILES_PER_RUN = 40;
const DEFAULT_INITIAL_LOOKBACK_DAYS = 7;

export async function syncWorkspaceAnalytics(
  prisma: PrismaClient,
  args: {
    actorEmail: string;
    env?: IntegrationEnv;
    fetchImpl?: typeof fetch;
    initialLookbackDays?: number;
    skipDecision?: boolean;
  },
): Promise<WorkspaceAnalyticsSyncResult> {
  const env = args.env ?? process.env;
  if (getIntegrationMode("openaicompliance", env) !== "real") {
    return {
      ok: false,
      reason: "INTEGRATION_OPENAI_COMPLIANCE is not real",
      byEventType: {},
    };
  }

  const creds = resolveComplianceCredentials(env);
  if (!creds) {
    return {
      ok: false,
      reason: "OPENAI_COMPLIANCE_API_KEY or CHATGPT_WORKSPACE_ID unset",
      byEventType: {},
    };
  }

  const lookbackDays = Math.min(
    Math.max(args.initialLookbackDays ?? DEFAULT_INITIAL_LOOKBACK_DAYS, 1),
    90,
  );
  const defaultAfter = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();

  let state = await loadWorkspaceAnalyticsSyncState(prisma);
  const byEventType: WorkspaceAnalyticsSyncResult["byEventType"] = {};

  for (const eventType of WORKSPACE_ANALYTICS_EVENT_TYPES) {
    byEventType[eventType] = await syncOneEventType({
      prisma,
      creds,
      eventType,
      state,
      defaultAfter,
      actorEmail: args.actorEmail,
      fetchImpl: args.fetchImpl,
    });
  }

  state = trimSyncState(state);
  await saveWorkspaceAnalyticsSyncState(prisma, state, args.actorEmail);

  if (!args.skipDecision) {
    await prisma.decision.create({
      data: {
        type: DecisionType.PROGRAM_VENDOR_EXPORT_IMPORT,
        beforeState: "{}",
        afterState: JSON.stringify({ byEventType }),
        actorEmail: args.actorEmail,
        justification: `Workspace Analytics API sync: ${WORKSPACE_ANALYTICS_EVENT_TYPES.map(
          (t) => `${t} files=${byEventType[t]?.filesDownloaded ?? 0} records=${byEventType[t]?.recordsParsed ?? 0}`,
        ).join("; ")}`,
      },
    });
  }

  return { ok: true, byEventType };
}

async function syncOneEventType(args: {
  prisma: PrismaClient;
  creds: NonNullable<ReturnType<typeof resolveComplianceCredentials>>;
  eventType: WorkspaceAnalyticsEventType;
  state: WorkspaceAnalyticsSyncState;
  defaultAfter: string;
  actorEmail: string;
  fetchImpl?: typeof fetch;
}): Promise<WorkspaceAnalyticsSyncEventSummary> {
  const summary: WorkspaceAnalyticsSyncEventSummary = {
    filesListed: 0,
    filesDownloaded: 0,
    recordsParsed: 0,
    recordsSkippedDuplicate: 0,
    snapshotsWritten: 0,
    vendorDaysUpserted: 0,
    lastEndTime: args.state.byEventType[args.eventType]?.lastEndTime ?? null,
  };

  const entry = args.state.byEventType[args.eventType] ?? {
    lastEndTime: null,
    recentEventIds: [],
    recentLogFileIds: [],
  };
  args.state.byEventType[args.eventType] = entry;

  let cursor = entry.lastEndTime ?? args.defaultAfter;
  let filesThisRun = 0;

  const userRows: ChatgptUserAnalyticsRow[] = [];
  const projectRows: ChatgptProjectAnalyticsRow[] = [];
  const gptRows: ChatgptGptAnalyticsRow[] = [];
  const surveyRows: ChatgptSurveyAnalyticsRow[] = [];

  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const list = await listComplianceLogFiles({
      creds: args.creds,
      eventType: args.eventType,
      after: cursor,
      limit: LIST_LIMIT,
      fetchImpl: args.fetchImpl,
    });
    const files = list.data ?? [];
    summary.filesListed += files.length;

    for (const file of files) {
      if (!file.id || filesThisRun >= MAX_FILES_PER_RUN) continue;
      if (hasSeenLogFileId(args.state, args.eventType, file.id)) continue;

      filesThisRun += 1;
      summary.filesDownloaded += 1;
      rememberLogFileId(args.state, args.eventType, file.id);

      const body = await downloadComplianceLogFile({
        creds: args.creds,
        logId: file.id,
        fetchImpl: args.fetchImpl,
      });

      const envelopes = parseWorkspaceAnalyticsJsonl(body);
      for (const env of envelopes) {
        if (hasSeenEventId(args.state, args.eventType, env.event_id)) {
          summary.recordsSkippedDuplicate += 1;
          continue;
        }
        const mapped = mapEnvelopeForEventType(args.eventType, env);
        if (!mapped) continue;
        rememberEventId(args.state, args.eventType, env.event_id);
        summary.recordsParsed += 1;

        switch (args.eventType) {
          case "CHATGPT_USER_ANALYTICS":
            userRows.push(mapped as ChatgptUserAnalyticsRow);
            break;
          case "CHATGPT_PROJECT_ANALYTICS":
            projectRows.push(mapped as ChatgptProjectAnalyticsRow);
            break;
          case "CHATGPT_GPT_ANALYTICS":
            gptRows.push(mapped as ChatgptGptAnalyticsRow);
            break;
          case "CHATGPT_SURVEY_ANALYTICS":
            surveyRows.push(mapped as ChatgptSurveyAnalyticsRow);
            break;
          default:
            break;
        }
      }

      if (file.end_time) {
        entry.lastEndTime = file.end_time;
        summary.lastEndTime = file.end_time;
      }
    }

    if (filesThisRun >= MAX_FILES_PER_RUN) break;
    if (list.has_more !== true || !list.last_end_time) break;
    cursor = list.last_end_time;
    entry.lastEndTime = list.last_end_time;
    summary.lastEndTime = list.last_end_time;
  }

  const prefix = `workspace-analytics-${args.eventType.toLowerCase()}`;

  if (args.eventType === "CHATGPT_USER_ANALYTICS" && userRows.length > 0) {
    const ing = await ingestUserAnalyticsRows(args.prisma, {
      rows: userRows,
      actorEmail: args.actorEmail,
      filenamePrefix: prefix,
    });
    summary.snapshotsWritten += ing.snapshotsWritten;
    summary.vendorDaysUpserted += ing.vendorDaysUpserted;
  }
  if (args.eventType === "CHATGPT_PROJECT_ANALYTICS" && projectRows.length > 0) {
    summary.snapshotsWritten += await ingestProjectAnalyticsRows(args.prisma, {
      rows: projectRows,
      actorEmail: args.actorEmail,
      filenamePrefix: prefix,
    });
  }
  if (args.eventType === "CHATGPT_GPT_ANALYTICS" && gptRows.length > 0) {
    summary.snapshotsWritten += await ingestGptAnalyticsRows(args.prisma, {
      rows: gptRows,
      actorEmail: args.actorEmail,
      filenamePrefix: prefix,
    });
  }
  if (args.eventType === "CHATGPT_SURVEY_ANALYTICS" && surveyRows.length > 0) {
    summary.snapshotsWritten += await ingestSurveyAnalyticsRows(args.prisma, {
      rows: surveyRows,
      actorEmail: args.actorEmail,
      filenamePrefix: prefix,
    });
  }

  return summary;
}
