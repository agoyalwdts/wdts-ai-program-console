import { SYNC_JOBS } from "./registry";
import type { SyncJobDefinition, SyncJobKey, SyncTier, SyncTrigger } from "./types";
import type { IntegrationEnv } from "@/lib/integrations/env";

export const DEFAULT_SYNC_JOB_TIMEOUT_MS = 12_000;

/** Wall-clock budget for parallel hot-tier jobs on dashboard page load. */
export const PAGE_LOAD_SYNC_MAX_WAIT_MS = 45_000;

const JOB_TIMEOUT_MS: Partial<
  Record<SyncJobKey, Partial<Record<SyncTrigger | "default", number>>>
> = {
  codex_enterprise_spend: {
    page_load: 40_000,
    manual_refresh: 90_000,
    cron: 120_000,
    admin: 120_000,
    default: 15_000,
  },
  cursor_vendor_spend: {
    page_load: 35_000,
    manual_refresh: 90_000,
    cron: 120_000,
    admin: 120_000,
    default: 12_000,
  },
  workspace_analytics: {
    page_load: 20_000,
    manual_refresh: 60_000,
    cron: 120_000,
    admin: 120_000,
    default: 12_000,
  },
  unified_credits: {
    page_load: 15_000,
    manual_refresh: 60_000,
    cron: 120_000,
    admin: 120_000,
    default: 12_000,
  },
  openai_org_costs: {
    manual_refresh: 60_000,
    cron: 120_000,
    admin: 120_000,
    default: 15_000,
  },
};

export function resolveSyncJobTimeoutMs(
  key: SyncJobKey,
  trigger: SyncTrigger,
  overrideMs?: number,
): number {
  if (overrideMs !== undefined) return overrideMs;
  const byTrigger = JOB_TIMEOUT_MS[key];
  return byTrigger?.[trigger] ?? byTrigger?.default ?? DEFAULT_SYNC_JOB_TIMEOUT_MS;
}

export function resolveSyncJobTimeoutForJob(
  job: SyncJobDefinition,
  trigger: SyncTrigger,
  overrideMs?: number,
): number {
  return resolveSyncJobTimeoutMs(job.key, trigger, overrideMs);
}

/** Max per-job timeout among enabled jobs in the given tiers (parallel page-load budget). */
export function computeSyncMaxWaitMs(args: {
  env?: IntegrationEnv;
  tiers: SyncTier[];
  trigger: SyncTrigger;
  overrideMs?: number;
}): number {
  if (args.overrideMs !== undefined) return args.overrideMs;
  if (args.trigger === "page_load") return PAGE_LOAD_SYNC_MAX_WAIT_MS;

  const env = args.env ?? process.env;
  const tierSet = new Set(args.tiers);
  let maxMs = DEFAULT_SYNC_JOB_TIMEOUT_MS;
  for (const job of SYNC_JOBS) {
    if (!tierSet.has(job.tier) || !job.isEnabled(env)) continue;
    maxMs = Math.max(maxMs, resolveSyncJobTimeoutForJob(job, args.trigger));
  }
  return maxMs;
}
