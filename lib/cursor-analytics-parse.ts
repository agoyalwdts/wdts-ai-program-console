/**
 * Normalise Cursor Analytics JSON into chart/table-friendly structures.
 * Vendor responses sometimes wrap rows in `{ data: [...] }`.
 */

export function unwrapCursorArray(data: unknown): unknown[] {
  if (data == null) return [];
  if (Array.isArray(data)) return data;
  if (typeof data === "object" && "data" in data) {
    const inner = (data as { data: unknown }).data;
    if (Array.isArray(inner)) return inner;
  }
  return [];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

export type DauRow = {
  date: string;
  dau: number;
  cli_dau: number;
  cloud_agent_dau: number;
  bugbot_dau: number;
};

export function parseDauRows(data: unknown): DauRow[] {
  return unwrapCursorArray(data)
    .filter(isRecord)
    .map((r) => ({
      date: String(r.date ?? r.event_date ?? ""),
      dau: Number(r.dau ?? 0) || 0,
      cli_dau: Number(r.cli_dau ?? 0) || 0,
      cloud_agent_dau: Number(r.cloud_agent_dau ?? 0) || 0,
      bugbot_dau: Number(r.bugbot_dau ?? 0) || 0,
    }))
    .filter((r) => r.date.length > 0);
}

export type ModelDayRow = {
  date: string;
  breakdown: Record<string, { messages: number; users: number }>;
};

export function parseModelDayRows(data: unknown): ModelDayRow[] {
  return unwrapCursorArray(data)
    .filter(isRecord)
    .map((r) => {
      const raw = r.model_breakdown;
      const breakdown: Record<string, { messages: number; users: number }> = {};
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        for (const [k, v] of Object.entries(raw)) {
          if (!isRecord(v)) continue;
          breakdown[k] = {
            messages: Number(v.messages ?? 0) || 0,
            users: Number(v.users ?? 0) || 0,
          };
        }
      }
      return {
        date: String(r.date ?? ""),
        breakdown,
      };
    })
    .filter((r) => r.date.length > 0);
}

export type AgentEditsRow = {
  event_date: string;
  total_suggested_diffs: number;
  total_accepted_diffs: number;
  total_green_lines_accepted: number;
  total_red_lines_accepted: number;
  total_lines_suggested: number;
};

export function parseAgentEditsRows(data: unknown): AgentEditsRow[] {
  return unwrapCursorArray(data)
    .filter(isRecord)
    .map((r) => {
      const gls = Number(r.total_green_lines_suggested ?? 0) || 0;
      const rls = Number(r.total_red_lines_suggested ?? 0) || 0;
      const lineSum = gls + rls;
      return {
        event_date: String(r.event_date ?? ""),
        total_suggested_diffs: Number(r.total_suggested_diffs ?? 0) || 0,
        total_accepted_diffs: Number(r.total_accepted_diffs ?? 0) || 0,
        total_green_lines_accepted: Number(r.total_green_lines_accepted ?? 0) || 0,
        total_red_lines_accepted: Number(r.total_red_lines_accepted ?? 0) || 0,
        total_lines_suggested:
          lineSum > 0 ? lineSum : Number(r.total_suggested_diffs ?? 0) || 0,
      };
    })
    .filter((r) => r.event_date.length > 0);
}

export type TabsRow = {
  event_date: string;
  total_suggestions: number;
  total_accepts: number;
  total_rejects: number;
  total_lines_accepted: number;
};

export function parseTabsRows(data: unknown): TabsRow[] {
  return unwrapCursorArray(data)
    .filter(isRecord)
    .map((r) => ({
      event_date: String(r.event_date ?? ""),
      total_suggestions: Number(r.total_suggestions ?? 0) || 0,
      total_accepts: Number(r.total_accepts ?? 0) || 0,
      total_rejects: Number(r.total_rejects ?? 0) || 0,
      total_lines_accepted: Number(r.total_lines_accepted ?? 0) || 0,
    }))
    .filter((r) => r.event_date.length > 0);
}

export type ClientVersionRow = {
  event_date: string;
  client_version: string;
  user_count: number;
  percentage: number;
};

export function parseClientVersionRows(data: unknown): ClientVersionRow[] {
  return unwrapCursorArray(data)
    .filter(isRecord)
    .map((r) => ({
      event_date: String(r.event_date ?? ""),
      client_version: String(r.client_version ?? "unknown"),
      user_count: Number(r.user_count ?? 0) || 0,
      percentage: Number(r.percentage ?? 0) || 0,
    }))
    .filter((r) => r.event_date.length > 0);
}

export type ExtensionRow = {
  event_date: string;
  file_extension: string;
  total_files: number;
  total_accepts: number;
  total_lines_accepted: number;
};

export function parseExtensionRows(data: unknown): ExtensionRow[] {
  return unwrapCursorArray(data)
    .filter(isRecord)
    .map((r) => ({
      event_date: String(r.event_date ?? ""),
      file_extension: String(r.file_extension ?? ""),
      total_files: Number(r.total_files ?? 0) || 0,
      total_accepts: Number(r.total_accepts ?? 0) || 0,
      total_lines_accepted: Number(r.total_lines_accepted ?? 0) || 0,
    }))
    .filter((r) => r.event_date.length > 0 && r.file_extension.length > 0);
}

/** Flat key-value rows for generic objects (e.g. /v1/me). */
export function objectToKeyValueRows(data: unknown): { key: string; value: string }[] {
  if (!isRecord(data)) return [];
  return Object.entries(data).map(([key, value]) => ({
    key,
    value:
      typeof value === "object"
        ? JSON.stringify(value)
        : String(value ?? ""),
  }));
}

/** Best-effort: first array found in object values, or unwrap top-level array. */
export function extractFirstArrayDeep(data: unknown, maxDepth = 3): unknown[] {
  const direct = unwrapCursorArray(data);
  if (direct.length > 0) return direct;
  if (!isRecord(data) || maxDepth <= 0) return [];
  for (const v of Object.values(data)) {
    if (Array.isArray(v) && v.length > 0) return v;
    if (isRecord(v)) {
      const inner = extractFirstArrayDeep(v, maxDepth - 1);
      if (inner.length > 0) return inner;
    }
  }
  return [];
}
