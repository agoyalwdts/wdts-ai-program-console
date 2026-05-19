/**
 * Upsert VendorDailySpend (CODEX) from Codex Enterprise Analytics
 * (api.chatgpt.com workspace usage, group=workspace).
 */

import { Product, type PrismaClient } from "@prisma/client";
import { DecisionType } from "@prisma/client";
import {
  localNoonFromApiUtcYmd,
  utcYmdFromUnixSec,
} from "@/lib/integrations/codex-enterprise-analytics/aggregate-workspace-daily";
import {
  CODEX_ENTERPRISE_ANALYTICS_VENDOR_KEY,
  fetchCodexEnterpriseWorkspaceUsageRows,
  resolveCodexEnterpriseAnalyticsCredentials,
  resolveUsdPerCredit,
} from "@/lib/integrations/codex-enterprise-analytics/fetch-workspace-usage";

export type CodexEnterpriseSyncResult = {
  daysUpserted: number;
  totalCredits: number;
  windowStartMs: number;
  windowEndMs: number;
};

export async function syncCodexEnterpriseAnalyticsDaily(
  prisma: PrismaClient,
  args: {
    lookbackDays: number;
    actorEmail: string;
    skipDecision?: boolean;
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
  },
): Promise<CodexEnterpriseSyncResult> {
  const env = args.env ?? process.env;
  const creds = resolveCodexEnterpriseAnalyticsCredentials(env);
  if (!creds) {
    throw new Error(
      "OPENAI_CODEX_ANALYTICS_API_KEY and CHATGPT_WORKSPACE_ID (or OPENAI_CHATGPT_WORKSPACE_ID) must be set.",
    );
  }

  const lookbackDays = Math.min(Math.max(args.lookbackDays, 1), 400);
  const endMs = Date.now();
  const startMs = endMs - lookbackDays * 24 * 60 * 60 * 1000;
  const startTimeSec = Math.floor(startMs / 1000);
  const endTimeSec = Math.floor(endMs / 1000);
  const usdPerCredit = resolveUsdPerCredit(env);

  const rows = await fetchCodexEnterpriseWorkspaceUsageRows({
    startTimeSec,
    endTimeSec,
    creds,
    fetchImpl: args.fetchImpl,
  });

  const byYmd = new Map<string, { credits: number; turns: number }>();
  let totalCredits = 0;
  for (const r of rows) {
    const ymd = utcYmdFromUnixSec(r.start_time);
    const c = typeof r.totals?.credits === "number" && Number.isFinite(r.totals.credits) ? r.totals.credits : 0;
    const t = typeof r.totals?.turns === "number" && Number.isFinite(r.totals.turns) ? r.totals.turns : 0;
    totalCredits += c;
    const prev = byYmd.get(ymd) ?? { credits: 0, turns: 0 };
    prev.credits += c;
    prev.turns += t;
    byYmd.set(ymd, prev);
  }

  const now = new Date();
  let daysUpserted = 0;
  for (const [ymd, agg] of byYmd) {
    const spendUsd = agg.credits * usdPerCredit;
    const day = localNoonFromApiUtcYmd(ymd);
    daysUpserted += 1;
    await prisma.vendorDailySpend.upsert({
      where: {
        vendor_product_day: {
          vendor: CODEX_ENTERPRISE_ANALYTICS_VENDOR_KEY,
          product: Product.CODEX,
          day,
        },
      },
      create: {
        vendor: CODEX_ENTERPRISE_ANALYTICS_VENDOR_KEY,
        product: Product.CODEX,
        day,
        spendUsd,
        eventCount: agg.turns,
        syncedAt: now,
      },
      update: {
        spendUsd,
        eventCount: agg.turns,
        syncedAt: now,
      },
    });
  }

  if (!args.skipDecision) {
    await prisma.decision.create({
      data: {
        type: DecisionType.CODEX_ENTERPRISE_ANALYTICS_SYNC,
        beforeState: "{}",
        afterState: JSON.stringify({
          daysUpserted,
          totalCredits,
          usdPerCredit,
          windowStartMs: startMs,
          windowEndMs: endMs,
          lookbackDays,
        }),
        actorEmail: args.actorEmail,
        justification: `Codex Enterprise Analytics: ${daysUpserted} VendorDailySpend row(s), ${totalCredits.toFixed(2)} total credits, lookback ${lookbackDays}d`,
      },
    });
  }

  return {
    daysUpserted,
    totalCredits,
    windowStartMs: startMs,
    windowEndMs: endMs,
  };
}
