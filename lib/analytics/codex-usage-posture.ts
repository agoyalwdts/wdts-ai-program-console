/**
 * Codex per-user usage posture from CODEX_SESSIONS_JSON snapshots
 * (models[], code_attribution) — clipped to an analytics window.
 */

import type { PrismaClient } from "@prisma/client";
import { normCodexAnalyticsEmail, resolveCodexUsageRowEmail } from "@/lib/integrations/codex-enterprise-analytics/aggregate-per-user-mtd";
import { utcYmdFromUnixSec } from "@/lib/integrations/codex-enterprise-analytics/aggregate-workspace-daily";
import type { CodexUsageRow } from "@/lib/integrations/codex-enterprise-analytics/types";

export type CodexUsageBucket = {
  date: string;
  email: string;
  credits: number;
  models: { model: string; credits: number }[];
  lines_added: number;
  lines_removed: number;
};

export type CodexUserUsagePosture = {
  email: string;
  credits_used: number;
  top_model: string | null;
  top_model_credits: number;
  lines_added: number;
  lines_removed: number;
};

export type CodexSessionsSnapshotPayload = {
  creditsByDate?: Record<string, number>;
  users?: { email: string; credits_used: number }[];
  usageBuckets?: CodexUsageBucket[];
  userCount?: number;
  rowCount?: number;
  source?: string;
};

export type CodexUsagePostureView = {
  modelCredits: { model: string; credits: number }[];
  attributionByDate: { date: string; lines_added: number; lines_removed: number }[];
  topUsers: CodexUserUsagePosture[];
  bucketCount: number;
  snapshotPeriodStart: string | null;
  snapshotPeriodEnd: string | null;
};

export type AnalyticsClipYmd = { start: string; end: string };

function ymdInClip(ymd: string, clip: AnalyticsClipYmd): boolean {
  return ymd >= clip.start && ymd <= clip.end;
}

export function buildUsageBucketsFromRows(
  rows: CodexUsageRow[],
  userIdToEmail?: ReadonlyMap<string, string>,
): CodexUsageBucket[] {
  const buckets: CodexUsageBucket[] = [];

  for (const row of rows) {
    const credits = row.totals?.credits ?? 0;
    if (credits <= 0) continue;
    const email = resolveCodexUsageRowEmail(row, userIdToEmail);
    if (!email) continue;

    const models: { model: string; credits: number }[] = [];
    for (const m of row.models ?? []) {
      if (!m.model || typeof m.credits !== "number" || m.credits <= 0) continue;
      models.push({ model: m.model, credits: m.credits });
    }

    buckets.push({
      date: utcYmdFromUnixSec(row.start_time),
      email: normCodexAnalyticsEmail(email),
      credits,
      models,
      lines_added: row.code_attribution?.lines_added ?? 0,
      lines_removed: row.code_attribution?.lines_removed ?? 0,
    });
  }

  return buckets;
}

export function clipUsageBuckets(
  buckets: CodexUsageBucket[],
  clip: AnalyticsClipYmd,
): CodexUsageBucket[] {
  return buckets.filter((b) => ymdInClip(b.date, clip));
}

export function aggregateModelCreditsFromBuckets(
  buckets: CodexUsageBucket[],
): { model: string; credits: number }[] {
  const byModel = new Map<string, number>();
  for (const b of buckets) {
    for (const m of b.models) {
      byModel.set(m.model, (byModel.get(m.model) ?? 0) + m.credits);
    }
  }
  return [...byModel.entries()]
    .map(([model, credits]) => ({ model, credits }))
    .sort((a, b) => b.credits - a.credits);
}

export function aggregateAttributionByDateFromBuckets(
  buckets: CodexUsageBucket[],
): { date: string; lines_added: number; lines_removed: number }[] {
  const byDate = new Map<string, { lines_added: number; lines_removed: number }>();
  for (const b of buckets) {
    if (b.lines_added <= 0 && b.lines_removed <= 0) continue;
    const prev = byDate.get(b.date) ?? { lines_added: 0, lines_removed: 0 };
    prev.lines_added += b.lines_added;
    prev.lines_removed += b.lines_removed;
    byDate.set(b.date, prev);
  }
  return [...byDate.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function aggregateUserPostureFromBuckets(buckets: CodexUsageBucket[]): CodexUserUsagePosture[] {
  const byEmail = new Map<
    string,
    {
      credits: number;
      modelCredits: Map<string, number>;
      lines_added: number;
      lines_removed: number;
    }
  >();

  for (const b of buckets) {
    const prev = byEmail.get(b.email) ?? {
      credits: 0,
      modelCredits: new Map<string, number>(),
      lines_added: 0,
      lines_removed: 0,
    };
    prev.credits += b.credits;
    for (const m of b.models) {
      prev.modelCredits.set(m.model, (prev.modelCredits.get(m.model) ?? 0) + m.credits);
    }
    prev.lines_added += b.lines_added;
    prev.lines_removed += b.lines_removed;
    byEmail.set(b.email, prev);
  }

  return [...byEmail.entries()]
    .map(([email, v]) => {
      let top_model: string | null = null;
      let top_model_credits = 0;
      for (const [model, c] of v.modelCredits) {
        if (c > top_model_credits) {
          top_model = model;
          top_model_credits = c;
        }
      }
      return {
        email,
        credits_used: v.credits,
        top_model,
        top_model_credits,
        lines_added: v.lines_added,
        lines_removed: v.lines_removed,
      };
    })
    .sort((a, b) => b.credits_used - a.credits_used);
}

export function parseCodexSessionsSnapshotPayload(payload: unknown): CodexSessionsSnapshotPayload | null {
  if (!payload || typeof payload !== "object") return null;
  return payload as CodexSessionsSnapshotPayload;
}

export function buildCodexUsagePostureView(args: {
  payload: unknown;
  clip: AnalyticsClipYmd;
  snapshotPeriodStart?: string | null;
  snapshotPeriodEnd?: string | null;
}): CodexUsagePostureView | null {
  const parsed = parseCodexSessionsSnapshotPayload(args.payload);
  if (!parsed?.usageBuckets?.length) return null;

  const clipped = clipUsageBuckets(parsed.usageBuckets, args.clip);
  if (clipped.length === 0) {
    return {
      modelCredits: [],
      attributionByDate: [],
      topUsers: [],
      bucketCount: 0,
      snapshotPeriodStart: args.snapshotPeriodStart ?? null,
      snapshotPeriodEnd: args.snapshotPeriodEnd ?? null,
    };
  }

  return {
    modelCredits: aggregateModelCreditsFromBuckets(clipped),
    attributionByDate: aggregateAttributionByDateFromBuckets(clipped),
    topUsers: aggregateUserPostureFromBuckets(clipped),
    bucketCount: clipped.length,
    snapshotPeriodStart: args.snapshotPeriodStart ?? null,
    snapshotPeriodEnd: args.snapshotPeriodEnd ?? null,
  };
}

export function buildCodexPostureByEmailFromPayload(payload: unknown): Map<string, CodexUserUsagePosture> {
  const parsed = parseCodexSessionsSnapshotPayload(payload);
  const map = new Map<string, CodexUserUsagePosture>();
  if (!parsed?.usageBuckets?.length) return map;
  for (const u of aggregateUserPostureFromBuckets(parsed.usageBuckets)) {
    map.set(normCodexAnalyticsEmail(u.email), u);
  }
  return map;
}

export async function loadLatestCodexSessionsSnapshot(prisma: PrismaClient): Promise<{
  payload: unknown;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
  filename: string;
} | null> {
  const row = await prisma.programVendorExportSnapshot.findFirst({
    where: { kind: "CODEX_SESSIONS_JSON" },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return null;
  return {
    payload: row.payload,
    periodStart: row.periodStart ? row.periodStart.toISOString().slice(0, 10) : null,
    periodEnd: row.periodEnd ? row.periodEnd.toISOString().slice(0, 10) : null,
    createdAt: row.createdAt.toISOString(),
    filename: row.filename,
  };
}
