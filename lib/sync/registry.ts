import { getIntegrationMode } from "@/lib/integrations/env";
import { syncUnifiedCredits } from "@/lib/integrations/unified-credits";
import { syncWorkspaceAnalytics } from "@/lib/integrations/workspace-analytics";
import { syncCodexEnterpriseAnalyticsDaily } from "@/lib/vendor-spend/sync-codex-enterprise-daily";
import { syncCursorVendorDailySpendWindow } from "@/lib/vendor-spend/sync-cursor-vendor-daily";
import { syncOpenAiVendorDailySpendWindow } from "@/lib/vendor-spend/sync-openai-vendor-daily";
import { deltaLookbackDays } from "./delta-lookback";
import type { SyncJobDefinition, SyncJobResult } from "./types";

const CURSOR_LOOKBACK = {
  min: 1,
  maxOnRefresh: 3,
  maxOnCron: 7,
  initial: 7,
} as const;

const CODEX_LOOKBACK = {
  min: 1,
  maxOnRefresh: 4,
  maxOnCron: 14,
  initial: 14,
} as const;

const OPENAI_LOOKBACK = {
  min: 1,
  maxOnRefresh: 7,
  maxOnCron: 31,
  initial: 31,
} as const;

export const SYNC_JOBS: SyncJobDefinition[] = [
  {
    key: "cursor_vendor_spend",
    label: "Cursor spend",
    tier: "hot",
    staleAfterMs: 5 * 60_000,
    isEnabled: (env) => getIntegrationMode("cursor", env) === "real",
    run: async (ctx): Promise<SyncJobResult> => {
      const lookbackDays =
        ctx.opts.lookbackDays ??
        deltaLookbackDays(ctx.lastSuccessAt, ctx.trigger, CURSOR_LOOKBACK);
      try {
        const result = await syncCursorVendorDailySpendWindow(ctx.prisma, {
          lookbackDays,
          endOffsetDays: ctx.opts.endOffsetDays ?? 0,
          actorEmail: ctx.actorEmail,
          skipDecision: ctx.opts.skipDecision === true,
        });
        return { ok: true, summary: { ...result, lookbackDays } };
      } catch (e) {
        return {
          ok: false,
          reason: e instanceof Error ? e.message : String(e),
        };
      }
    },
  },
  {
    key: "codex_enterprise_spend",
    label: "Codex Enterprise",
    tier: "hot",
    staleAfterMs: 5 * 60_000,
    isEnabled: (env) => getIntegrationMode("codexenterprise", env) === "real",
    run: async (ctx): Promise<SyncJobResult> => {
      const lookbackDays =
        ctx.opts.lookbackDays ??
        deltaLookbackDays(ctx.lastSuccessAt, ctx.trigger, CODEX_LOOKBACK);
      try {
        const result = await syncCodexEnterpriseAnalyticsDaily(ctx.prisma, {
          lookbackDays,
          actorEmail: ctx.actorEmail,
          skipDecision: ctx.opts.skipDecision === true,
          env: ctx.env,
        });
        return { ok: true, summary: { ...result, lookbackDays } };
      } catch (e) {
        return {
          ok: false,
          reason: e instanceof Error ? e.message : String(e),
        };
      }
    },
  },
  {
    key: "workspace_analytics",
    label: "ChatGPT workspace analytics",
    tier: "hot",
    staleAfterMs: 5 * 60_000,
    isEnabled: (env) => getIntegrationMode("openaicompliance", env) === "real",
    run: async (ctx): Promise<SyncJobResult> => {
      const initialLookbackDays =
        ctx.opts.initialLookbackDays ??
        (ctx.trigger === "cron"
          ? 7
          : deltaLookbackDays(ctx.lastSuccessAt, ctx.trigger, {
              min: 1,
              maxOnRefresh: 7,
              maxOnCron: 7,
              initial: 7,
            }));
      const result = await syncWorkspaceAnalytics(ctx.prisma, {
        actorEmail: ctx.actorEmail,
        initialLookbackDays,
        env: ctx.env,
        skipDecision: ctx.opts.skipDecision === true,
      });
      if (!result.ok) {
        return { ok: false, reason: result.reason ?? "workspace analytics sync failed" };
      }
      return { ok: true, summary: result as unknown as Record<string, unknown> };
    },
  },
  {
    key: "unified_credits",
    label: "Unified Credits COSTS",
    tier: "hot",
    staleAfterMs: 5 * 60_000,
    isEnabled: (env) => getIntegrationMode("openaicompliance", env) === "real",
    run: async (ctx): Promise<SyncJobResult> => {
      const initialLookbackDays =
        ctx.opts.initialLookbackDays ??
        (ctx.trigger === "cron"
          ? 30
          : deltaLookbackDays(ctx.lastSuccessAt, ctx.trigger, {
              min: 1,
              maxOnRefresh: 7,
              maxOnCron: 30,
              initial: 30,
            }));
      const result = await syncUnifiedCredits(ctx.prisma, {
        actorEmail: ctx.actorEmail,
        initialLookbackDays,
        env: ctx.env,
        skipDecision: ctx.opts.skipDecision === true,
      });
      if (!result.ok) {
        if (result.notEnabled) {
          return { ok: true, skipped: true, reason: "COSTS not enabled on Compliance API" };
        }
        return { ok: false, reason: result.reason ?? "unified credits sync failed" };
      }
      return { ok: true, summary: result as unknown as Record<string, unknown> };
    },
  },
  {
    key: "openai_org_costs",
    label: "OpenAI org costs",
    tier: "warm",
    staleAfterMs: 60 * 60_000,
    isEnabled: (env) => getIntegrationMode("openai", env) === "real",
    run: async (ctx): Promise<SyncJobResult> => {
      const lookbackDays =
        ctx.opts.lookbackDays ??
        deltaLookbackDays(ctx.lastSuccessAt, ctx.trigger, OPENAI_LOOKBACK);
      try {
        const result = await syncOpenAiVendorDailySpendWindow(ctx.prisma, {
          lookbackDays,
          endOffsetDays: ctx.opts.endOffsetDays ?? 0,
          actorEmail: ctx.actorEmail,
          skipDecision: ctx.opts.skipDecision === true,
        });
        return { ok: true, summary: { ...result, lookbackDays } };
      } catch (e) {
        return {
          ok: false,
          reason: e instanceof Error ? e.message : String(e),
        };
      }
    },
  },
];

export const SYNC_JOB_BY_KEY = new Map(SYNC_JOBS.map((j) => [j.key, j]));
