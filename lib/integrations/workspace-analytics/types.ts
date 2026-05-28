import type { WorkspaceAnalyticsEventType } from "./event-types";

export type WorkspaceAnalyticsEnvelope = {
  event_id: string;
  type: string;
  timestamp?: string;
  payload: Record<string, unknown>;
};

export type ChatgptUserAnalyticsRow = {
  event_id: string;
  event_date: string;
  workspace_id?: string;
  user_id: string;
  email?: string;
  name?: string;
  role?: string;
  user_role?: string;
  department?: string;
  groups?: unknown;
  user_status?: string;
  is_active?: boolean | string;
  messages?: number;
  credits_used?: number;
  gpt_messages?: number;
  project_messages?: number;
  tool_messages?: number;
  last_day_active?: string;
  raw: Record<string, unknown>;
};

export type ChatgptProjectAnalyticsRow = {
  event_id: string;
  event_date: string;
  project_id: string;
  project_name?: string;
  messages?: number;
  active_users?: number;
  raw: Record<string, unknown>;
};

export type ChatgptGptAnalyticsRow = {
  event_id: string;
  event_date: string;
  gpt_id: string;
  gpt_name?: string;
  messages?: number;
  active_users?: number;
  raw: Record<string, unknown>;
};

export type ChatgptSurveyAnalyticsRow = {
  event_id: string;
  event_date: string;
  user_id?: string;
  email?: string;
  survey_id?: string;
  survey_name?: string;
  question_id?: string;
  answer_id?: string;
  raw: Record<string, unknown>;
};

export type WorkspaceAnalyticsSyncState = {
  version: 1;
  byEventType: Partial<
    Record<
      WorkspaceAnalyticsEventType,
      {
        lastEndTime: string | null;
        recentEventIds: string[];
        recentLogFileIds: string[];
      }
    >
  >;
};

export type WorkspaceAnalyticsSyncEventSummary = {
  filesListed: number;
  filesDownloaded: number;
  recordsParsed: number;
  recordsSkippedDuplicate: number;
  snapshotsWritten: number;
  vendorDaysUpserted: number;
  lastEndTime: string | null;
};

export type WorkspaceAnalyticsSyncResult = {
  ok: boolean;
  reason?: string;
  byEventType: Partial<Record<WorkspaceAnalyticsEventType, WorkspaceAnalyticsSyncEventSummary>>;
};
