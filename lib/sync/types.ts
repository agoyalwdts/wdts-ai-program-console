import type { PrismaClient } from "@prisma/client";
import type { IntegrationEnv } from "@/lib/integrations/env";

export type SyncJobKey =
  | "cursor_vendor_spend"
  | "codex_enterprise_spend"
  | "workspace_analytics"
  | "unified_credits"
  | "openai_org_costs"
  | "openai_admin_audit";

export type SyncTrigger = "cron" | "page_load" | "manual_refresh" | "admin";

export type SyncTier = "hot" | "warm";

export type SyncJobRunOptions = {
  lookbackDays?: number;
  endOffsetDays?: number;
  skipDecision?: boolean;
  initialLookbackDays?: number;
};

export type SyncJobContext = {
  prisma: PrismaClient;
  trigger: SyncTrigger;
  actorEmail: string;
  env: IntegrationEnv;
  lastSuccessAt: Date | null;
  opts: SyncJobRunOptions;
};

export type SyncJobResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  summary?: Record<string, unknown>;
};

export type SyncJobDefinition = {
  key: SyncJobKey;
  label: string;
  tier: SyncTier;
  /** Skip page_load / manual when last success is newer than this. */
  staleAfterMs: number;
  isEnabled: (env: IntegrationEnv) => boolean;
  run: (ctx: SyncJobContext) => Promise<SyncJobResult>;
};

export type SyncJobOutcome = {
  key: SyncJobKey;
  label: string;
  ok: boolean;
  skipped: boolean;
  timedOut: boolean;
  ms: number;
  error?: string;
  reason?: string;
};

export type RefreshDashboardMirrorsResult = {
  trigger: SyncTrigger;
  ran: number;
  skipped: number;
  failed: number;
  timedOut: number;
  jobs: SyncJobOutcome[];
  /** Oldest lastSuccessAt among enabled hot jobs (for freshness bar). */
  oldestHotSuccessAt: Date | null;
};

export type FreshnessJobRow = {
  key: SyncJobKey;
  label: string;
  lastSuccessAt: Date | null;
  lastAttemptAt: Date | null;
  lastTrigger: string | null;
  lastError: string | null;
};

export type FreshnessSummary = {
  jobs: FreshnessJobRow[];
  oldestHotSuccessAt: Date | null;
  refreshResult?: RefreshDashboardMirrorsResult;
};