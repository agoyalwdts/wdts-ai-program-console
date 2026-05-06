/**
 * Read-only snapshots across Cursor Analytics, Admin, AI Code Tracking, and
 * Cloud Agents APIs (https://cursor.com/docs/api). Used by /analytics.
 *
 * The dashboard still uses POST /teams/filtered-usage-events only for
 * VendorDailySpend sync; this module is for the operator analytics surface.
 */

import { IntegrationError } from "../errors";
import { getIntegrationMode, type IntegrationEnv } from "../env";
import { cursorTeamGetJson } from "./cursor-team-http";
import { resolveCursorTeamAdminApiKey } from "./team-admin-usage";
import type { Fetch } from "../_http";

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
    key: "adminMembers",
    label: "Team members",
    apiFamily: "Admin API",
    path: "/teams/members",
  },
  {
    key: "aiCodeCommits",
    label: "AI code commits (sample page)",
    apiFamily: "AI Code Tracking API",
    path: "/analytics/ai-code/commits",
    query: { page: "1", pageSize: "20" },
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

export type CursorApiOverview = {
  integrationMode: "real" | "synthetic";
  apiKeyConfigured: boolean;
  window: { startDate: string; endDate: string };
  slices: Record<string, CursorApiSlice>;
};

export type LoadCursorApiOverviewOptions = {
  env?: IntegrationEnv;
  fetchImpl?: Fetch;
  /** Passed to Analytics + AI Code Tracking paths that accept startDate/endDate. */
  analyticsWindow?: { startDate: string; endDate: string };
};

export async function loadCursorApiOverview(
  opts: LoadCursorApiOverviewOptions = {},
): Promise<CursorApiOverview> {
  const env = opts.env ?? process.env;
  const fetchImpl = opts.fetchImpl;
  const window = opts.analyticsWindow ?? { startDate: "30d", endDate: "today" };
  const apiKey = resolveCursorTeamAdminApiKey(env);
  const mode = getIntegrationMode("cursor", env);

  const skipped = (reason: string): CursorApiSlice => ({
    status: "skipped",
    reason,
  });

  if (mode !== "real") {
    const slices = Object.fromEntries(
      CURSOR_OVERVIEW_PANELS.map((p) => [
        p.key,
        skipped("INTEGRATION_CURSOR is not `real`."),
      ]),
    );
    return {
      integrationMode: "synthetic",
      apiKeyConfigured: Boolean(apiKey),
      window,
      slices,
    };
  }

  if (!apiKey) {
    const slices = Object.fromEntries(
      CURSOR_OVERVIEW_PANELS.map((p) => [
        p.key,
        skipped("No Team Admin API key (set CURSOR_TEAM_ADMIN_API_KEY or CURSOR_ADMIN_TOKEN)."),
      ]),
    );
    return {
      integrationMode: "real",
      apiKeyConfigured: false,
      window,
      slices,
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
      // Admin + Cloud paths ignore startDate/endDate; leaving them does not matter for /teams/members;
      // strip for cleaner URLs on paths that are not analytics.
      if (
        panel.path.startsWith("/teams/") ||
        panel.path.startsWith("/v1/")
      ) {
        delete q.startDate;
        delete q.endDate;
      }
      const slice = await mapErr(() =>
        cursorTeamGetJson({ path: panel.path, query: q, apiKey, fetchImpl }),
      );
      return [panel.key, slice] as const;
    }),
  );

  return {
    integrationMode: "real",
    apiKeyConfigured: true,
    window,
    slices: Object.fromEntries(entries),
  };
}
