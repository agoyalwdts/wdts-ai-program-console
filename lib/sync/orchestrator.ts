import type { PrismaClient } from "@prisma/client";
import {
  getSyncLedgerRow,
  recordSyncAttempt,
  recordSyncFailure,
  recordSyncSuccess,
} from "./ledger";
import { SYNC_JOB_BY_KEY, SYNC_JOBS } from "./registry";
import type {
  FreshnessSummary,
  RefreshDashboardMirrorsResult,
  SyncJobKey,
  SyncJobRunOptions,
  SyncTier,
  SyncTrigger,
} from "./types";

const PAGE_LOAD_DEBOUNCE_MS = 30_000;
const DEFAULT_PER_JOB_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

function isStale(lastSuccessAt: Date | null, staleAfterMs: number, force: boolean): boolean {
  if (force) return true;
  if (!lastSuccessAt) return true;
  return Date.now() - lastSuccessAt.getTime() > staleAfterMs;
}

function shouldDebouncePageLoad(
  trigger: SyncTrigger,
  lastAttemptAt: Date | null,
  lastSuccessAt: Date | null,
): boolean {
  if (trigger !== "page_load" || !lastAttemptAt) return false;
  const sinceAttempt = Date.now() - lastAttemptAt.getTime();
  if (sinceAttempt > PAGE_LOAD_DEBOUNCE_MS) return false;
  if (!lastSuccessAt || lastSuccessAt.getTime() < lastAttemptAt.getTime()) {
    return true;
  }
  return sinceAttempt < PAGE_LOAD_DEBOUNCE_MS;
}

export async function executeSyncJob(
  prisma: PrismaClient,
  key: SyncJobKey,
  args: {
    trigger: SyncTrigger;
    actorEmail: string;
    opts?: SyncJobRunOptions;
    env?: Record<string, string | undefined>;
    perJobTimeoutMs?: number;
  },
): Promise<RefreshDashboardMirrorsResult["jobs"][number]> {
  const job = SYNC_JOB_BY_KEY.get(key);
  if (!job) {
    return {
      key,
      label: key,
      ok: false,
      skipped: true,
      timedOut: false,
      ms: 0,
      error: "unknown job key",
    };
  }

  const env = args.env ?? process.env;
  if (!job.isEnabled(env)) {
    return {
      key,
      label: job.label,
      ok: true,
      skipped: true,
      timedOut: false,
      ms: 0,
      reason: "integration not real",
    };
  }

  const ledger = await getSyncLedgerRow(prisma, key);
  const started = Date.now();
  await recordSyncAttempt(prisma, key, args.trigger);

  try {
    const result = await withTimeout(
      job.run({
        prisma,
        trigger: args.trigger,
        actorEmail: args.actorEmail,
        env,
        lastSuccessAt: ledger.lastSuccessAt,
        opts: args.opts ?? {},
      }),
      args.perJobTimeoutMs ?? DEFAULT_PER_JOB_TIMEOUT_MS,
    );

    if (result.skipped) {
      return {
        key,
        label: job.label,
        ok: true,
        skipped: true,
        timedOut: false,
        ms: Date.now() - started,
        reason: result.reason,
      };
    }

    if (!result.ok) {
      const err = result.reason ?? "sync failed";
      await recordSyncFailure(prisma, key, args.trigger, err);
      return {
        key,
        label: job.label,
        ok: false,
        skipped: false,
        timedOut: false,
        ms: Date.now() - started,
        error: err,
      };
    }

    await recordSyncSuccess(prisma, key, args.trigger, result.summary ?? { ok: true });
    return {
      key,
      label: job.label,
      ok: true,
      skipped: false,
      timedOut: false,
      ms: Date.now() - started,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const timedOut = message.includes("timed out after");
    await recordSyncFailure(prisma, key, args.trigger, message);
    return {
      key,
      label: job.label,
      ok: false,
      skipped: false,
      timedOut,
      ms: Date.now() - started,
      error: message,
    };
  }
}

export async function refreshDashboardMirrors(
  prisma: PrismaClient,
  args: {
    trigger: SyncTrigger;
    actorEmail: string;
    tiers?: SyncTier[];
    force?: boolean;
    maxWaitMs?: number;
    env?: Record<string, string | undefined>;
    jobOpts?: Partial<Record<SyncJobKey, SyncJobRunOptions>>;
  },
): Promise<RefreshDashboardMirrorsResult> {
  const env = args.env ?? process.env;
  const tiers = new Set(args.tiers ?? ["hot"]);
  const maxWaitMs = args.maxWaitMs ?? 15_000;
  const deadline = Date.now() + maxWaitMs;

  const candidates = SYNC_JOBS.filter(
    (j) => tiers.has(j.tier) && j.isEnabled(env),
  );

  const toRun: SyncJobKey[] = [];
  const skippedOutcomes: RefreshDashboardMirrorsResult["jobs"] = [];

  for (const job of candidates) {
    const ledger = await getSyncLedgerRow(prisma, job.key);
    if (
      args.trigger === "page_load" &&
      shouldDebouncePageLoad(args.trigger, ledger.lastAttemptAt, ledger.lastSuccessAt)
    ) {
      skippedOutcomes.push({
        key: job.key,
        label: job.label,
        ok: true,
        skipped: true,
        timedOut: false,
        ms: 0,
        reason: "debounced recent attempt",
      });
      continue;
    }
    if (!isStale(ledger.lastSuccessAt, job.staleAfterMs, args.force === true)) {
      skippedOutcomes.push({
        key: job.key,
        label: job.label,
        ok: true,
        skipped: true,
        timedOut: false,
        ms: 0,
        reason: "still fresh",
      });
      continue;
    }
    toRun.push(job.key);
  }

  const remainingMs = () => Math.max(0, deadline - Date.now());
  const runOutcomes: RefreshDashboardMirrorsResult["jobs"] = [];

  await Promise.all(
    toRun.map(async (key) => {
      const timeout = Math.min(DEFAULT_PER_JOB_TIMEOUT_MS, remainingMs() || 1);
      const outcome = await executeSyncJob(prisma, key, {
        trigger: args.trigger,
        actorEmail: args.actorEmail,
        opts: args.jobOpts?.[key],
        env,
        perJobTimeoutMs: timeout,
      });
      runOutcomes.push(outcome);
    }),
  );

  const jobs = [...skippedOutcomes, ...runOutcomes];
  const hotRows = await loadFreshnessSummary(prisma, env);

  return {
    trigger: args.trigger,
    ran: jobs.filter((j) => !j.skipped).length,
    skipped: jobs.filter((j) => j.skipped).length,
    failed: jobs.filter((j) => !j.skipped && !j.ok).length,
    timedOut: jobs.filter((j) => j.timedOut).length,
    jobs,
    oldestHotSuccessAt: hotRows.oldestHotSuccessAt,
  };
}

export async function loadFreshnessSummary(
  prisma: PrismaClient,
  env: Record<string, string | undefined> = process.env,
): Promise<FreshnessSummary> {
  const jobs = [];
  const hotSuccesses: Date[] = [];

  for (const def of SYNC_JOBS) {
    if (!def.isEnabled(env)) continue;
    const row = await getSyncLedgerRow(prisma, def.key);
    jobs.push({
      key: def.key,
      label: def.label,
      lastSuccessAt: row.lastSuccessAt,
      lastAttemptAt: row.lastAttemptAt,
      lastTrigger: row.lastTrigger,
      lastError: row.lastError,
    });
    if (def.tier === "hot" && row.lastSuccessAt) {
      hotSuccesses.push(row.lastSuccessAt);
    }
  }

  const oldestHotSuccessAt =
    hotSuccesses.length > 0
      ? new Date(Math.min(...hotSuccesses.map((d) => d.getTime())))
      : null;

  return { jobs, oldestHotSuccessAt };
}
