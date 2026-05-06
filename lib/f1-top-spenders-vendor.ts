/**
 * Merge gateway mirror top spenders with vendor-attributed ChatGPT spend from
 * the latest overlapping CHATGPT_USERS_CSV import (Business users export).
 *
 * OpenAI org costs / Cursor Team Admin / Codex EA sync only materialise
 * program-level VendorDailySpend rows — no per-user dimension — so the only
 * built-in per-user vendor signal today is this CSV snapshot.
 */

import type { PrismaClient } from "@prisma/client";
import { inclusiveDayCountYmd } from "@/lib/imports/program-vendor-export/dates";
import { formatLocalYmd } from "@/lib/f1-period";
import { OPENAI_CREDIT_OVERAGE_USD } from "@/lib/program";
import type { TopSpender } from "@/lib/integrations/gateway/types";

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function overlapInclusiveDays(planStart: Date, planEnd: Date, expStart: Date, expEnd: Date): number {
  const a0 = startOfLocalDay(planStart);
  const a1 = startOfLocalDay(planEnd);
  const b0 = startOfLocalDay(expStart);
  const b1 = startOfLocalDay(expEnd);
  const lo = a0.getTime() > b0.getTime() ? a0 : b0;
  const hi = a1.getTime() < b1.getTime() ? a1 : b1;
  if (lo.getTime() > hi.getTime()) return 0;
  return inclusiveDayCountYmd(formatLocalYmd(lo), formatLocalYmd(hi));
}

type ChatgptPayload = {
  periodStart?: string;
  periodEnd?: string;
  users?: { email: string; credits_used: number }[];
};

/** Normalise email for matching Prisma `User.email` (exact match in DB). */
function normEmail(e: string): string {
  return e.trim().toLowerCase();
}

/**
 * Returns gateway top spenders merged with prorated ChatGPT CSV credits per
 * user, sorted by total descending, capped at `limit`.
 */
export async function mergeTopSpendersWithVendorAttribution(
  prisma: PrismaClient,
  args: {
    planPeriodStart: Date;
    planPeriodEnd: Date;
    gatewayTop: TopSpender[];
    limit: number;
  },
): Promise<TopSpender[]> {
  const { planPeriodStart, planPeriodEnd, gatewayTop, limit } = args;

  const combined = new Map<string, { totalUsd: number; requestCount: number }>();
  for (const row of gatewayTop) {
    combined.set(row.userId, {
      totalUsd: row.totalUsd,
      requestCount: row.requestCount,
    });
  }

  const snapshots = await prisma.programVendorExportSnapshot.findMany({
    where: { kind: "CHATGPT_USERS_CSV" },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: {
      periodStart: true,
      periodEnd: true,
      payload: true,
    },
  });

  for (const snap of snapshots) {
    if (!snap.periodStart || !snap.periodEnd) continue;
    const overlap = overlapInclusiveDays(
      planPeriodStart,
      planPeriodEnd,
      snap.periodStart,
      snap.periodEnd,
    );
    if (overlap <= 0) continue;

    const expStartYmd = formatLocalYmd(snap.periodStart);
    const expEndYmd = formatLocalYmd(snap.periodEnd);
    const exportDays = inclusiveDayCountYmd(expStartYmd, expEndYmd);
    if (exportDays <= 0) continue;

    const factor = overlap / exportDays;
    const payload = snap.payload as ChatgptPayload;
    const users = payload.users ?? [];
    if (users.length === 0) continue;

    const emails = [...new Set(users.map((u) => normEmail(u.email)).filter(Boolean))];
    if (emails.length === 0) continue;

    const idByNormEmail = new Map<string, string>();
    const chunkSize = 40;
    for (let i = 0; i < emails.length; i += chunkSize) {
      const chunk = emails.slice(i, i + chunkSize);
      const dbUsers = await prisma.user.findMany({
        where: {
          OR: chunk.map((e) => ({ email: { equals: e, mode: "insensitive" as const } })),
        },
        select: { id: true, email: true },
      });
      for (const u of dbUsers) {
        idByNormEmail.set(normEmail(u.email), u.id);
      }
    }

    for (const u of users) {
      const e = normEmail(u.email);
      const uid = idByNormEmail.get(e);
      if (!uid) continue;
      const credits = typeof u.credits_used === "number" ? u.credits_used : Number(u.credits_used);
      if (!Number.isFinite(credits) || credits <= 0) continue;
      const vendorUsd = credits * OPENAI_CREDIT_OVERAGE_USD * factor;
      const prev = combined.get(uid) ?? { totalUsd: 0, requestCount: 0 };
      combined.set(uid, {
        totalUsd: prev.totalUsd + vendorUsd,
        requestCount: prev.requestCount,
      });
    }

    // Use the newest overlapping snapshot only (exports are full-period totals).
    break;
  }

  const merged: TopSpender[] = [...combined.entries()].map(([userId, v]) => ({
    userId,
    totalUsd: v.totalUsd,
    requestCount: v.requestCount,
  }));
  merged.sort((a, b) => b.totalUsd - a.totalUsd);
  return merged.slice(0, Math.max(1, Math.min(limit, 100)));
}
