/**
 * Workspace Analytics API event_type values (Compliance Logs Platform beta).
 * @see docs/integrations/workspace-analytics-api-beta.md
 */

export const WORKSPACE_ANALYTICS_EVENT_TYPES = [
  "CHATGPT_USER_ANALYTICS",
  "CHATGPT_PROJECT_ANALYTICS",
  "CHATGPT_GPT_ANALYTICS",
  "CHATGPT_SURVEY_ANALYTICS",
] as const;

export type WorkspaceAnalyticsEventType = (typeof WORKSPACE_ANALYTICS_EVENT_TYPES)[number];

export function isWorkspaceAnalyticsEventType(s: string): s is WorkspaceAnalyticsEventType {
  return (WORKSPACE_ANALYTICS_EVENT_TYPES as readonly string[]).includes(s);
}

/** Maps API event_type → ProgramVendorExportSnapshot.kind */
export const SNAPSHOT_KIND_BY_EVENT_TYPE: Record<WorkspaceAnalyticsEventType, string> = {
  CHATGPT_USER_ANALYTICS: "CHATGPT_USER_ANALYTICS",
  CHATGPT_PROJECT_ANALYTICS: "CHATGPT_PROJECT_ANALYTICS",
  CHATGPT_GPT_ANALYTICS: "CHATGPT_GPT_ANALYTICS",
  CHATGPT_SURVEY_ANALYTICS: "CHATGPT_SURVEY_ANALYTICS",
};

export const WORKSPACE_ANALYTICS_SYNC_STATE_KIND = "WORKSPACE_ANALYTICS_SYNC_STATE";
