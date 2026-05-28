/**
 * Parse Workspace Analytics JSONL from Compliance Logs downloads.
 * Beta schema: envelope + type-specific payload (field names per OpenAI spec).
 */

import type { WorkspaceAnalyticsEventType } from "./event-types";
import type {
  ChatgptGptAnalyticsRow,
  ChatgptProjectAnalyticsRow,
  ChatgptSurveyAnalyticsRow,
  ChatgptUserAnalyticsRow,
  WorkspaceAnalyticsEnvelope,
} from "./types";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

/** Merge envelope fields with nested analytics objects (beta shape may nest payload). */
function extractPayload(raw: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...raw };
  const nestedKeys = [
    "chatgpt_user_analytics",
    "chatgpt_project_analytics",
    "chatgpt_gpt_analytics",
    "chatgpt_survey_analytics",
    "analytics",
    "data",
    "payload",
  ];
  for (const key of nestedKeys) {
    const nested = asRecord(raw[key]);
    if (nested) Object.assign(merged, nested);
  }
  return merged;
}

export function parseWorkspaceAnalyticsJsonl(body: string): WorkspaceAnalyticsEnvelope[] {
  const out: WorkspaceAnalyticsEnvelope[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let raw: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line) as unknown;
      const rec = asRecord(parsed);
      if (!rec) continue;
      raw = rec;
    } catch {
      continue;
    }
    const event_id = pickString(raw, ["event_id", "eventId"]);
    const type = pickString(raw, ["type", "event_type", "eventType"]);
    if (!event_id || !type) continue;
    out.push({
      event_id,
      type,
      timestamp: pickString(raw, ["timestamp", "ts"]),
      payload: extractPayload(raw),
    });
  }
  return out;
}

function normalizeEventDate(payload: Record<string, unknown>, timestamp?: string): string | null {
  const d =
    pickString(payload, ["event_date", "eventDate"]) ??
    (timestamp ? timestamp.slice(0, 10) : undefined);
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return d;
}

export function mapUserAnalyticsEnvelope(
  env: WorkspaceAnalyticsEnvelope,
): ChatgptUserAnalyticsRow | null {
  const p = env.payload;
  const event_date = normalizeEventDate(p, env.timestamp);
  const user_id = pickString(p, ["user_id", "userId"]);
  if (!event_date || !user_id) return null;
  return {
    event_id: env.event_id,
    event_date,
    workspace_id: pickString(p, ["workspace_id", "workspaceId"]),
    user_id,
    email: pickString(p, ["email"]),
    name: pickString(p, ["name"]),
    role: pickString(p, ["role"]),
    user_role: pickString(p, ["user_role", "userRole"]),
    department: pickString(p, ["department"]),
    groups: p.groups,
    user_status: pickString(p, ["user_status", "userStatus"]),
    is_active:
      typeof p.is_active === "boolean"
        ? p.is_active
        : typeof p.isActive === "boolean"
          ? p.isActive
          : undefined,
    messages: pickNumber(p, ["messages"]),
    credits_used: pickNumber(p, ["credits_used", "creditsUsed"]),
    gpt_messages: pickNumber(p, ["gpt_messages", "gptMessages"]),
    project_messages: pickNumber(p, ["project_messages", "projectMessages"]),
    tool_messages: pickNumber(p, ["tool_messages", "toolMessages"]),
    last_day_active: pickString(p, ["last_day_active", "lastDayActive"]),
    raw: p,
  };
}

export function mapProjectAnalyticsEnvelope(
  env: WorkspaceAnalyticsEnvelope,
): ChatgptProjectAnalyticsRow | null {
  const p = env.payload;
  const event_date = normalizeEventDate(p, env.timestamp);
  const project_id = pickString(p, ["project_id", "projectId"]);
  if (!event_date || !project_id) return null;
  return {
    event_id: env.event_id,
    event_date,
    project_id,
    project_name: pickString(p, ["project_name", "projectName"]),
    messages: pickNumber(p, ["messages"]),
    active_users: pickNumber(p, ["active_users", "activeUsers"]),
    raw: p,
  };
}

export function mapGptAnalyticsEnvelope(
  env: WorkspaceAnalyticsEnvelope,
): ChatgptGptAnalyticsRow | null {
  const p = env.payload;
  const event_date = normalizeEventDate(p, env.timestamp);
  const gpt_id = pickString(p, ["gpt_id", "gptId"]);
  if (!event_date || !gpt_id) return null;
  return {
    event_id: env.event_id,
    event_date,
    gpt_id,
    gpt_name: pickString(p, ["gpt_name", "gptName"]),
    messages: pickNumber(p, ["messages"]),
    active_users: pickNumber(p, ["active_users", "activeUsers"]),
    raw: p,
  };
}

export function mapSurveyAnalyticsEnvelope(
  env: WorkspaceAnalyticsEnvelope,
): ChatgptSurveyAnalyticsRow | null {
  const p = env.payload;
  const event_date = normalizeEventDate(p, env.timestamp);
  if (!event_date) return null;
  return {
    event_id: env.event_id,
    event_date,
    user_id: pickString(p, ["user_id", "userId"]),
    email: pickString(p, ["email"]),
    survey_id: pickString(p, ["survey_id", "surveyId"]),
    survey_name: pickString(p, ["survey_name", "surveyName"]),
    question_id: pickString(p, ["question_id", "questionId"]),
    answer_id: pickString(p, ["answer_id", "answerId"]),
    raw: p,
  };
}

export function mapEnvelopeForEventType(
  eventType: WorkspaceAnalyticsEventType,
  env: WorkspaceAnalyticsEnvelope,
):
  | ChatgptUserAnalyticsRow
  | ChatgptProjectAnalyticsRow
  | ChatgptGptAnalyticsRow
  | ChatgptSurveyAnalyticsRow
  | null {
  if (env.type !== eventType && env.type !== eventType.toLowerCase()) {
    return null;
  }
  switch (eventType) {
    case "CHATGPT_USER_ANALYTICS":
      return mapUserAnalyticsEnvelope(env);
    case "CHATGPT_PROJECT_ANALYTICS":
      return mapProjectAnalyticsEnvelope(env);
    case "CHATGPT_GPT_ANALYTICS":
      return mapGptAnalyticsEnvelope(env);
    case "CHATGPT_SURVEY_ANALYTICS":
      return mapSurveyAnalyticsEnvelope(env);
    default:
      return null;
  }
}
