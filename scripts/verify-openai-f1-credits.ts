/**
 * Reconcile F1 OpenAI credit tiles against VendorDailySpend mirrors.
 *
 * Usage (prod DB via tunnel or firewall rule):
 *   DATABASE_URL='postgresql://...' npx tsx scripts/verify-openai-f1-credits.ts
 *   DATABASE_URL='...' npx tsx scripts/verify-openai-f1-credits.ts --from 2026-06-01 --to 2026-06-25
 */

import { Product } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadOpenAiSpendSnapshotForF1 } from "@/lib/f1-openai-spend";
import {
  sumOpenAiOrgPoolUsdFromMerged,
} from "@/lib/f1-openai-credits";
import { loadOpenAiDailyMergedSpendForF1 } from "@/lib/f1-openai-daily-spend";
import { OPENAI_CREDIT_OVERAGE_USD } from "@/lib/program";
import {
  CODEX_ENTERPRISE_ANALYTICS_VENDOR_KEY,
  resolveUsdPerCredit,
} from "@/lib/integrations/codex-enterprise-analytics/fetch-workspace-usage";
import { WORKSPACE_ANALYTICS_USER_VENDOR_KEY } from "@/lib/integrations/workspace-analytics/vendor-key";
import {
  loadOpenAiOrgEnvelopeLayers,
  sumOpenAiPortalAlignedEnvelopeUsd,
} from "@/lib/f1-openai-org-envelope";
import { OPENAI_ORG_COSTS_VENDOR_KEY } from "@/lib/integrations/openai/org-costs";
import { UNIFIED_CREDITS_VENDOR_KEY } from "@/lib/integrations/unified-credits/constants";

function parseArgs(): { periodStart: Date; periodEnd: Date } {
  const fromIdx = process.argv.indexOf("--from");
  const toIdx = process.argv.indexOf("--to");
  const fromYmd = fromIdx >= 0 ? process.argv[fromIdx + 1] : "2026-06-01";
  const toYmd = toIdx >= 0 ? process.argv[toIdx + 1] : "2026-06-25";
  const [fy, fm, fd] = fromYmd.split("-").map(Number);
  const [ty, tm, td] = toYmd.split("-").map(Number);
  return {
    periodStart: new Date(fy, fm - 1, fd, 0, 0, 0, 0),
    periodEnd: new Date(ty, tm - 1, td, 23, 59, 59, 999),
  };
}

async function rawVendorSum(args: {
  periodStart: Date;
  periodEnd: Date;
  vendor: string;
  product: Product;
}): Promise<{ usd: number; days: number; minDay: string | null; maxDay: string | null }> {
  const startDay = new Date(args.periodStart);
  startDay.setHours(0, 0, 0, 0);
  const endDay = new Date(args.periodEnd);
  endDay.setHours(0, 0, 0, 0);
  const rangeStart = new Date(
    startDay.getFullYear(),
    startDay.getMonth(),
    startDay.getDate(),
    12,
    0,
    0,
    0,
  );
  const rangeEnd = new Date(
    endDay.getFullYear(),
    endDay.getMonth(),
    endDay.getDate(),
    12,
    0,
    0,
    0,
  );

  const rows = await prisma.vendorDailySpend.findMany({
    where: {
      vendor: args.vendor,
      product: args.product,
      day: { gte: rangeStart, lte: rangeEnd },
    },
    select: { day: true, spendUsd: true },
    orderBy: { day: "asc" },
  });

  let usd = 0;
  for (const r of rows) usd += r.spendUsd;
  const minDay = rows[0]?.day.toISOString().slice(0, 10) ?? null;
  const maxDay = rows.at(-1)?.day.toISOString().slice(0, 10) ?? null;
  return { usd, days: rows.length, minDay, maxDay };
}

async function main(): Promise<void> {
  const { periodStart, periodEnd } = parseArgs();
  const codexUsdPerCredit = resolveUsdPerCredit();

  const [wa, codexEa, unifiedChat, unifiedCodex, orgCostsChat, orgCostsCodex, merged, snapshot, envelopeLayers] =
    await Promise.all([
    rawVendorSum({
      periodStart,
      periodEnd,
      vendor: WORKSPACE_ANALYTICS_USER_VENDOR_KEY,
      product: Product.CHATGPT,
    }),
    rawVendorSum({
      periodStart,
      periodEnd,
      vendor: CODEX_ENTERPRISE_ANALYTICS_VENDOR_KEY,
      product: Product.CODEX,
    }),
    rawVendorSum({
      periodStart,
      periodEnd,
      vendor: UNIFIED_CREDITS_VENDOR_KEY,
      product: Product.CHATGPT,
    }),
    rawVendorSum({
      periodStart,
      periodEnd,
      vendor: UNIFIED_CREDITS_VENDOR_KEY,
      product: Product.CODEX,
    }),
    rawVendorSum({
      periodStart,
      periodEnd,
      vendor: OPENAI_ORG_COSTS_VENDOR_KEY,
      product: Product.CHATGPT,
    }),
    rawVendorSum({
      periodStart,
      periodEnd,
      vendor: OPENAI_ORG_COSTS_VENDOR_KEY,
      product: Product.CODEX,
    }),
    loadOpenAiDailyMergedSpendForF1(prisma, { periodStart, periodEnd }),
    loadOpenAiSpendSnapshotForF1(prisma, { periodStart, periodEnd }),
    loadOpenAiOrgEnvelopeLayers(prisma, { periodStart, periodEnd }),
  ]);

  const orgPoolUsd = sumOpenAiOrgPoolUsdFromMerged({ merged, periodStart, periodEnd });
  const portalEnvelopeUsd = sumOpenAiPortalAlignedEnvelopeUsd({
    merged,
    layers: envelopeLayers,
    periodStart,
    periodEnd,
  });

  const waCredits = wa.usd / OPENAI_CREDIT_OVERAGE_USD;
  const codexEaCredits = codexEa.usd / codexUsdPerCredit;
  const unifiedPoolUsd = unifiedChat.usd + unifiedCodex.usd;
  const unifiedPoolCredits = unifiedPoolUsd / OPENAI_CREDIT_OVERAGE_USD;
  const orgCostsUsd = orgCostsChat.usd + orgCostsCodex.usd;
  const orgCostsCredits = orgCostsUsd / OPENAI_CREDIT_OVERAGE_USD;
  const portalCredits = portalEnvelopeUsd / OPENAI_CREDIT_OVERAGE_USD;

  console.log("OpenAI F1 credit reconciliation");
  console.log("Period:", periodStart.toISOString().slice(0, 10), "→", periodEnd.toISOString().slice(0, 10));
  console.log("");
  console.log("── Raw VendorDailySpend (mirror) ──");
  console.log(
    `Workspace Analytics (org pool rows): ${wa.days} days, $${wa.usd.toFixed(2)} → ${Math.round(waCredits).toLocaleString()} credits @ $${OPENAI_CREDIT_OVERAGE_USD}`,
  );
  if (wa.minDay) console.log(`  coverage: ${wa.minDay} … ${wa.maxDay}`);
  console.log(
    `Codex Enterprise Analytics:          ${codexEa.days} days, $${codexEa.usd.toFixed(2)} → ${Math.round(codexEaCredits).toLocaleString()} credits @ $${codexUsdPerCredit}`,
  );
  if (codexEa.minDay) console.log(`  coverage: ${codexEa.minDay} … ${codexEa.maxDay}`);
  if (unifiedChat.days > 0 || unifiedCodex.days > 0) {
    console.log(
      `Unified Credits (chat+cod slices):   chat $${unifiedChat.usd.toFixed(2)} + cod $${unifiedCodex.usd.toFixed(2)} → ${Math.round(unifiedPoolCredits).toLocaleString()} pool credits`,
    );
  }
  console.log(
    `OpenAI Org Costs API (chat+cod):     chat $${orgCostsChat.usd.toFixed(2)} + cod $${orgCostsCodex.usd.toFixed(2)} → ${Math.round(orgCostsCredits).toLocaleString()} credits`,
  );
  if (orgCostsChat.minDay) console.log(`  coverage: ${orgCostsChat.minDay} … ${orgCostsChat.maxDay}`);
  console.log("");
  console.log("── F1 computed org pool (WA + unified only) ──");
  console.log(`WA org pool USD: $${orgPoolUsd.toFixed(2)} → ${Math.round(orgPoolUsd / OPENAI_CREDIT_OVERAGE_USD).toLocaleString()} credits`);
  console.log(
    `Portal-aligned envelope USD: $${portalEnvelopeUsd.toFixed(2)} → ${Math.round(portalCredits).toLocaleString()} credits (unified > org-costs > WA per day)`,
  );
  console.log("");
  console.log("── F1 snapshot (what /health tiles show) ──");
  console.log(`Combined (org pool): ${Math.round(snapshot.credits.combinedCredits).toLocaleString()} credits`);
  console.log(`ChatGPT tile:        ${Math.round(snapshot.credits.chatgptCredits).toLocaleString()} credits`);
  console.log(`Codex tile:          ${Math.round(snapshot.credits.codexCredits).toLocaleString()} credits`);
  console.log(`Sources: chatgpt=${snapshot.sources.chatgpt} codex=${snapshot.sources.codex} combined=${snapshot.credits.combinedSource ?? "n/a"}`);
  console.log("");
  console.log("── Cross-checks ──");
  const poolMatch =
    Math.abs(snapshot.credits.combinedCredits - orgPoolUsd / OPENAI_CREDIT_OVERAGE_USD) < 1;
  const codexMatch = Math.abs(snapshot.credits.codexCredits - codexEaCredits) < 1;
  const chatgptMath =
    Math.abs(
      snapshot.credits.chatgptCredits -
        Math.max(0, snapshot.credits.combinedCredits - snapshot.credits.codexCredits),
    ) < 1;
  console.log(`Pool tile = org-pool sum:     ${poolMatch ? "OK" : "MISMATCH"}`);
  console.log(`Codex tile = EA mirror sum:   ${codexMatch ? "OK" : "MISMATCH"}`);
  console.log(`ChatGPT = pool − Codex:       ${chatgptMath ? "OK" : "MISMATCH"}`);
  if (wa.days > 0 && wa.maxDay) {
    const waEnd = wa.maxDay;
    const periodEndYmd = `${periodEnd.getFullYear()}-${String(periodEnd.getMonth() + 1).padStart(2, "0")}-${String(periodEnd.getDate()).padStart(2, "0")}`;
    if (waEnd < periodEndYmd) {
      console.log("");
      console.log(
        `⚠ Workspace Analytics ends ${waEnd} but period ends ${periodEndYmd} — org pool may be incomplete for MTD.`,
      );
    }
    if (codexEa.minDay && codexEa.minDay > periodStart.toISOString().slice(0, 10)) {
      console.log(
        `⚠ Codex mirror starts ${codexEa.minDay} (after period start) — early-June Codex may be missing.`,
      );
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
