/**
 * Read-only snapshots across Cursor Analytics, Admin, AI Code Tracking, and
 * Cloud Agents APIs (https://cursor.com/docs/api). Used by /analytics.
 *
 * The dashboard still uses POST /teams/filtered-usage-events only for
 * VendorDailySpend sync; this module is for the operator analytics surface.
 */

import { analyticsWindowToEpochMs } from "@/lib/cursor-analytics-dates";
import { IntegrationError } from "../errors";
import { getIntegrationMode, type IntegrationEnv } from "../env";
import { cursorTeamGetJson, cursorTeamPostJson } from "./cursor-team-http";
import {
  resolveCursorCloudAgentsApiKey,
  resolveCursorTeamAdminApiKey,
} from "./team-admin-usage";
import type { Fetch } from "../_http";
import {
  fetchAllAiCodeCommitsForWindow,
  rollupAiCodeCommits,
  type AiCodeRollup,
} from "./ai-code-rollup";

export type CursorApiSlice =
  | { status: "ok"; data: unknown }
  | { status: "error"; message: string }
  | { status: "skipped"; reason: string };

export type CursorOverviewPanel = {
  key: string;
  label: string;
  apiFamily: string;
  path: string;
  query?: Record<string, string>;
};

/** Panels we fetch on /analytics (subset of full vendor catalogue). */
export const CURSOR_OVERVIEW_PANELS: CursorOverviewPanel[] = [
  {
    key: "analyticsDau",
    label: "Daily active users",
    apiFamily: "Analytics API",
    path: "/analytics/team/dau",
  },
  {
    key: "analyticsModels",
    label: "Model usage",
    apiFamily: "Analytics API",
    path: "/analytics/team/models",
  },
  {
    key: "analyticsAgentEdits",
    label: "Agent edits",
    apiFamily: "Analytics API",
    path: "/analytics/team/agent-edits",
  },
  {
    key: "analyticsTabs",
    label: "Tab autocomplete",
    apiFamily: "Analytics API",
    path: "/analytics/team/tabs",
  },
  {
    key: "analyticsClientVersions",
    label: "Client versions",
    apiFamily: "Analytics API",
    path: "/analytics/team/client-versions",
  },
  {
    key: "analyticsTopExtensions",
    label: "Top file extensions",
    apiFamily: "Analytics API",
    path: "/analytics/team/top-file-extensions",
  },
  {
    key: "analyticsMcp",
    label: "MCP",
    apiFamily: "Analytics API",
    path: "/analytics/team/mcp",
  },
  {
    key: "analyticsLeaderboard",
    label: "Usage leaderboard",
    apiFamily: "Analytics API",
    path: "/analytics/team/leaderboard",
    query: { page: "1", pageSize: "10" },
  },
  {
    key: "analyticsConversationInsights",
    label: "Conversation insights",
    apiFamily: "Analytics API",
    path: "/analytics/team/conversation-insights",
    query: {
      include: "intents,complexity,categories,guidanceLevels,workTypes",
    },
  },
  {
    key: "analyticsByUserModels",
    label: "Model usage (by user)",
    apiFamily: "Analytics API",
    path: "/analytics/by-user/models",
    query: { page: "1", pageSize: "50" },
  },
  {
    key: "adminMembers",
    label: "Team members",
    apiFamily: "Admin API",
    path: "/teams/members",
  },
  {
    key: "cloudMe",
    label: "API key metadata",
    apiFamily: "Cloud Agents API",
    path: "/v1/me",
  },
  {
    key: "cloudAgents",
    label: "Cloud agents (recent)",
    apiFamily: "Cloud Agents API",
    path: "/v1/agents",
    query: { limit: "10" },
  },
];

async function mapErr(fn: () => Promise<unknown>): Promise<CursorApiSlice> {
  try {
    return { status: "ok", data: await fn() };
  } catch (e) {
    const msg =
      e instanceof IntegrationError
        ? e.message
        : e instanceof Error
          ? e.message
          : String(e);
    return { status: "error", message: msg };
  }
}

export type AiCodeRollupSlice =
  | { status: "ok"; rollup: AiCodeRollup }
  | { status: "error"; message: string }
  | { status: "skipped"; reason: string };

export type CursorApiOverview = {
  integrationMode: "real" | "synthetic";
  apiKeyConfigured: boolean;
  window: { startDate: string; endDate: string };
  slices: Record<string, CursorApiSlice>;
  /** Paginated AI Code Tracking commits, rolled up for charts/tables (Enterprise). */
  aiCodeRollup: AiCodeRollupSlice;
};

export type LoadCursorApiOverviewOptions = {
  env?: IntegrationEnv;
  fetchImpl?: Fetch;
  /** Passed to Analytics + AI Code Tracking paths that accept startDate/endDate. */
  analyticsWindow?: { startDate: string; endDate: string };
};

/** Slices loaded outside {@link CURSOR_OVERVIEW_PANELS} (Admin POST endpoints). */
export const CURSOR_OVERVIEW_ADMIN_SLICE_KEYS = ["adminDailyUsage", "adminTeamSpend"] as const;

function parseUsersFilter(env: IntegrationEnv): string | undefined {
  const raw = env.CURSOR_ANALYTICS_USERS_FILTER?.trim();
  if (!raw) return undefined;
  const parts = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  return parts.join(",");
}

type TeamSpendResponse = {
  teamMemberSpend?: unknown[];
  totalPages?: number;
};

async function fetchAdminDailyUsageSnapshot(args: {
  apiKey: string;
  window: { startDate: string; endDate: string };
  fetchImpl?: Fetch;
}): Promise<unknown> {
  const { startMs, endMs } = analyticsWindowToEpochMs(args.window);
  return cursorTeamPostJson({
    path: "/teams/daily-usage-data",
    body: { startDate: startMs, endDate: endMs },
    apiKey: args.apiKey,
    fetchImpl: args.fetchImpl,
  });
}

async function fetchTeamSpendAllPages(args: {
  apiKey: string;
  fetchImpl?: Fetch;
}): Promise<{ teamMemberSpend: unknown[]; pagesFetched: number }> {
  const all: unknown[] = [];
  let page = 1;
  let pagesFetched = 0;
  for (;;) {
    const res = await cursorTeamPostJson<TeamSpendResponse>({
      path: "/teams/spend",
      body: { page, pageSize: 100 },
      apiKey: args.apiKey,
      fetchImpl: args.fetchImpl,
    });
    pagesFetched += 1;
    const batch = Array.isArray(res.teamMemberSpend) ? res.teamMemberSpend : [];
    all.push(...batch);
    const totalPages = typeof res.totalPages === "number" && res.totalPages > 0 ? res.totalPages : 1;
    if (page >= totalPages || page >= 500) break;
    page += 1;
  }
  return { teamMemberSpend: all, pagesFetched };
}

export async function loadCursorApiOverview(
  opts: LoadCursorApiOverviewOptions = {},
): Promise<CursorApiOverview> {
  const env = opts.env ?? process.env;
  const fetchImpl = opts.fetchImpl;
  const window = opts.analyticsWindow ?? { startDate: "30d", endDate: "today" };
  const apiKey = resolveCursorTeamAdminApiKey(env);
  const cloudAgentsApiKey = resolveCursorCloudAgentsApiKey(env);
  const mode = getIntegrationMode("cursor", env);
  const usersFilter = parseUsersFilter(env);

  const skipped = (reason: string): CursorApiSlice => ({
    status: "skipped",
    reason,
  });

  const skippedRollup = (reason: string): AiCodeRollupSlice => ({
    status: "skipped",
    reason,
  });

  if (mode !== "real") {
    const skipPairs = [
      ...CURSOR_OVERVIEW_PANELS.map((p) => [p.key, skipped("INTEGRATION_CURSOR is not `real`.")] as const),
      ...CURSOR_OVERVIEW_ADMIN_SLICE_KEYS.map(
        (k) => [k, skipped("INTEGRATION_CURSOR is not `real`.")] as const,
      ),
    ];
    const slices = Object.fromEntries(skipPairs);
    return {
      integrationMode: "synthetic",
      apiKeyConfigured: Boolean(apiKey),
      window,
      slices,
      aiCodeRollup: skippedRollup("INTEGRATION_CURSOR is not `real`."),
    };
  }

  if (!apiKey) {
    const skipPairs = [
      ...CURSOR_OVERVIEW_PANELS.map(
        (p) =>
          [
            p.key,
            skipped("No Team Admin API key (set CURSOR_TEAM_ADMIN_API_KEY or CURSOR_ADMIN_TOKEN)."),
          ] as const,
      ),
      ...CURSOR_OVERVIEW_ADMIN_SLICE_KEYS.map(
        (k) =>
          [
            k,
            skipped("No Team Admin API key (set CURSOR_TEAM_ADMIN_API_KEY or CURSOR_ADMIN_TOKEN)."),
          ] as const,
      ),
    ];
    const slices = Object.fromEntries(skipPairs);
    return {
      integrationMode: "real",
      apiKeyConfigured: false,
      window,
      slices,
      aiCodeRollup: skippedRollup(
        "No Team Admin API key (set CURSOR_TEAM_ADMIN_API_KEY or CURSOR_ADMIN_TOKEN).",
      ),
    };
  }

  const baseQuery: Record<string, string> = {
    startDate: window.startDate,
    endDate: window.endDate,
  };

  const entries = await Promise.all(
    CURSOR_OVERVIEW_PANELS.map(async (panel) => {
      const q: Record<string, string | number | undefined> = {
        ...baseQuery,
        ...panel.query,
      };
      if (
        usersFilter &&
        (panel.key === "analyticsConversationInsights" || panel.key === "analyticsByUserModels")
      ) {
        q.users = usersFilter;
      }
      // Admin + Cloud paths ignore startDate/endDate; leaving them does not matter for /teams/members;
      // strip for cleaner URLs on paths that are not analytics.
      if (
        panel.path.startsWith("/teams/") ||
        panel.path.startsWith("/v1/")
      ) {
        delete q.startDate;
        delete q.endDate;
      }
      const isCloudAgentsPath = panel.path.startsWith("/v1/");
      if (isCloudAgentsPath && !cloudAgentsApiKey) {
        return [
          panel.key,
          skipped(
            "Cloud Agents API needs CURSOR_CLOUD_AGENTS_API_KEY (or CURSOR_INTEGRATIONS_API_KEY) from Dashboard → Integrations. Admin API keys return 401 on /v1/*.",
          ),
        ] as const;
      }
      const keyForRequest = isCloudAgentsPath ? cloudAgentsApiKey! : apiKey;
      const slice = await mapErr(() =>
        cursorTeamGetJson({ path: panel.path, query: q, apiKey: keyForRequest, fetchImpl }),
      );
      return [panel.key, slice] as const;
    }),
  );

  const [adminDailySlice, adminSpendSlice] = await Promise.all([
    mapErr(() =>
      fetchAdminDailyUsageSnapshot({ apiKey, window, fetchImpl }),
    ),
    mapErr(async () => {
      const { teamMemberSpend, pagesFetched } = await fetchTeamSpendAllPages({
        apiKey,
        fetchImpl,
      });
      return {
        teamMemberSpend,
        pagesFetched,
        note:
          "POST /teams/spend — monthlyLimitDollars / hardLimitOverrideDollars vs policy caps (read-only).",
      };
    }),
  ]);

  let aiCodeRollup: AiCodeRollupSlice;
  try {
    const items = await fetchAllAiCodeCommitsForWindow({
      apiKey,
      startDate: window.startDate,
      endDate: window.endDate,
      fetchImpl,
    });
    aiCodeRollup = { status: "ok", rollup: rollupAiCodeCommits(items) };
  } catch (e) {
    const msg =
      e instanceof IntegrationError
        ? e.message
        : e instanceof Error
          ? e.message
          : String(e);
    aiCodeRollup = { status: "error", message: msg };
  }

  return {
    integrationMode: "real",
    apiKeyConfigured: true,
    window,
    slices: {
      ...Object.fromEntries(entries),
      adminDailyUsage: adminDailySlice,
      adminTeamSpend: adminSpendSlice,
    },
    aiCodeRollup,
  };
}
