import { Suspense } from "react";
import { Topbar } from "@/components/dashboard/topbar";
import { F1PeriodRangeLine } from "@/components/dashboard/f1-period-range-line";
import { HealthPeriodSelector } from "@/components/dashboard/health-period-selector";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { BudgetBar } from "@/components/charts/budget-bar";
import { SpendTrendChart, type SpendPoint } from "@/components/charts/spend-trend-chart";
import { YtdProductComparisonChart } from "@/components/charts/ytd-product-comparison-chart";
import {
  OPENAI_AVERAGE_OVERAGE_CREDITS_MONTH,
  OPENAI_POOLED_CREDITS_MONTH,
  OPENAI_TARGET_CREDITS_MONTH,
  MONTHLY_BUDGET_USD,
  OPENAI_CHATGPT_CODEX_ENTITLED_SEATS,
  OPENAI_CHATGPT_CODEX_LICENSES_ALLOTTED,
  OPENAI_CREDIT_OVERAGE_USD,
  OPENAI_LICENSE_USD_PER_SEAT_MONTH,
  OPENAI_POOLED_BASELINE_USD_MONTH,
  OPENAI_COMBINED_MONTHLY_PLANNING_USD,
  PROGRAM_MONTHLY_PLANNING_USD_TOTAL,
  PROGRAM_ANNUAL_PLANNING_USD_TOTAL,
  PROGRAM_ANNUAL_PLANNING_YTD_ACTUALS_USD,
  M365_COPILOT_LICENSES_ENTITLED,
  M365_COPILOT_USD_PER_LICENSE_YEAR,
  M365_COPILOT_ANNUAL_COMMIT_USD,
  M365_COPILOT_MONTHLY_COMMIT_USD,
  PRODUCTS,
  type ProductKey,
} from "@/lib/program";
import { formatUsd } from "@/lib/utils";
import { getGatewayClient } from "@/lib/integrations";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadCursorVendorSpendForF1, mergeCursorVendorIntoF1 } from "@/lib/f1-cursor-vendor";
import { mergeCursorTopSpendersForF1 } from "@/lib/f1-cursor-top-spenders";
import { OpenAiF1WindowSelector } from "@/components/dashboard/openai-f1-window-selector";
import {
  f1PeriodSpendLabel,
  resolveF1PlanFromSearchParams,
  type F1Period,
  type F1PeriodPlan,
} from "@/lib/f1-period";
import { mergeOpenAiSpendIntoPagePeriodF1, loadOpenAiSpendSnapshotForF1 } from "@/lib/f1-openai-spend";
import {
  parseOpenAiF1Window,
  planOpenAiF1Spend,
  type OpenAiF1SpendPlan,
} from "@/lib/f1-openai-window";
import { mergeTopSpendersWithVendorAttribution } from "@/lib/f1-top-spenders-vendor";
import {
  enrichLeaderboardRows,
  mirrorTopSpendersByProducts,
  type F1LeaderboardRow,
} from "@/lib/f1-health-leaderboards";
import {
  annualizedProgramActualUsdForYtd,
  loadProgramYtdObservedSpendUsd,
  programObservedTotalUsd,
  programPlanningYtdUsdForActuals,
  programYtdComparisonRows,
} from "@/lib/f1-program-observed-spend";
import { Product } from "@prisma/client";

export const dynamic = "force-dynamic";

type SP = { period?: string; from?: string; to?: string; openaiWindow?: string };

function formatCredits(n: number): string {
  return `${Math.max(n, 0).toLocaleString("en-US", { maximumFractionDigits: 0 })} credits`;
}

const OPENAI_CARD_SPLIT = {
  CHATGPT: 1,
  CODEX: 3,
} as const;

async function getF1Data(
  period: F1Period,
  plan: F1PeriodPlan,
  openAiSpendPlan: OpenAiF1SpendPlan,
): Promise<{
  mtdMap: Map<ProductKey, number>;
  days: SpendPoint[];
  topCursor: F1LeaderboardRow[];
  topChatGptCodex: F1LeaderboardRow[];
  openAiSpend: Awaited<ReturnType<typeof loadOpenAiSpendSnapshotForF1>>;
  openAiSpendPlan: OpenAiF1SpendPlan;
  plan: F1PeriodPlan;
  period: F1Period;
  cursorSpendSource: "gateway" | "vendor";
  cursorLeaderboardSource: "gateway" | "vendor";
}> {
  const gateway = getGatewayClient();

  const [programAgg, dailyAgg, vendorCursor, openAiSpend] = await Promise.all([
    gateway.aggregateByProgram({ periodStart: plan.periodStart, periodEnd: plan.periodEnd }),
    gateway.aggregateByProgramDaily({ since: plan.periodStart, until: plan.periodEnd }),
    loadCursorVendorSpendForF1(prisma, {
      periodStart: plan.periodStart,
      periodEnd: plan.periodEnd,
    }),
    loadOpenAiSpendSnapshotForF1(prisma, {
      periodStart: openAiSpendPlan.periodStart,
      periodEnd: openAiSpendPlan.periodEnd,
      budgetMonthMultiplier: openAiSpendPlan.budgetMonthMultiplier,
    }),
  ]);

  const mtdMap = new Map<ProductKey, number>(
    programAgg.map((r) => [r.product, r.totalUsd]),
  );

  const days: SpendPoint[] = dailyAgg.map((d) => ({
    day: d.day,
    CURSOR: d.byProduct.CURSOR,
    CHATGPT: d.byProduct.CHATGPT,
    CODEX: d.byProduct.CODEX,
    CLAUDE_AI: d.byProduct.CLAUDE_AI,
    M365_COPILOT: d.byProduct.M365_COPILOT,
  }));

  mergeCursorVendorIntoF1({
    mtdMap,
    days,
    cursorVendorTotal: vendorCursor.periodTotalUsd,
    cursorByChartDay: vendorCursor.byChartDay,
    useVendor: vendorCursor.usedVendor,
  });
  await mergeOpenAiSpendIntoPagePeriodF1(prisma, {
    periodStart: plan.periodStart,
    periodEnd: plan.periodEnd,
    mtdMap,
    days,
  });

  const cursorSpendSource: "gateway" | "vendor" = vendorCursor.usedVendor
    ? "vendor"
    : "gateway";

  const [cursorMirror, openAiMirror] = await Promise.all([
    mirrorTopSpendersByProducts(prisma, {
      products: [Product.CURSOR],
      periodStart: plan.periodStart,
      periodEnd: plan.periodEnd,
      candidateLimit: 40,
    }),
    mirrorTopSpendersByProducts(prisma, {
      products: [Product.CHATGPT, Product.CODEX],
      periodStart: openAiSpendPlan.periodStart,
      periodEnd: openAiSpendPlan.periodEnd,
      candidateLimit: 80,
    }),
  ]);

  const cursorMerged = await mergeCursorTopSpendersForF1(prisma, {
    planPeriodStart: plan.periodStart,
    planPeriodEnd: plan.periodEnd,
    gatewayTop: cursorMirror,
    limit: 10,
  });
  const topCursor = await enrichLeaderboardRows(prisma, cursorMerged.rows, {
    products: [Product.CURSOR],
    budgetMonthMultiplier: plan.budgetMonthMultiplier,
  });

  const openAiMerged = await mergeTopSpendersWithVendorAttribution(prisma, {
    planPeriodStart: openAiSpendPlan.periodStart,
    planPeriodEnd: openAiSpendPlan.periodEnd,
    gatewayTop: openAiMirror,
    limit: 10,
  });
  const topChatGptCodex = await enrichLeaderboardRows(prisma, openAiMerged, {
    products: [Product.CHATGPT, Product.CODEX],
    budgetMonthMultiplier: openAiSpendPlan.budgetMonthMultiplier,
  });

  return {
    mtdMap,
    days,
    topCursor,
    topChatGptCodex,
    openAiSpend,
    openAiSpendPlan,
    plan,
    period,
    cursorSpendSource,
    cursorLeaderboardSource: cursorMerged.usedVendor ? "vendor" : "gateway",
  };
}

function LeaderboardTable({
  rows,
  emptyLabel,
}: {
  rows: F1LeaderboardRow[];
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return <div className="px-5 py-8 text-sm text-slate-500">{emptyLabel}</div>;
  }
  return (
    <Table>
      <THead>
        <TR>
          <TH className="px-5">User</TH>
          <TH>Email</TH>
          <TH>Sub-tier</TH>
          <TH className="text-right">vs cap</TH>
          <TH className="text-right pr-5">Period spend</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((u) => (
          <TR key={u.id}>
            <TD className="pl-5 font-medium text-slate-900">{u.displayName}</TD>
            <TD className="text-slate-600">{u.email}</TD>
            <TD>
              {u.subTier ? (
                <code className="font-mono text-xs text-slate-700">{u.subTier}</code>
              ) : (
                <span className="text-slate-400">—</span>
              )}
            </TD>
            <TD className="text-right">
              {u.pctOfCap != null ? (
                <Badge variant={u.pctOfCap >= 100 ? "warning" : "outline"}>
                  {u.pctOfCap.toFixed(0)}%
                </Badge>
              ) : (
                <span className="text-slate-400">—</span>
              )}
            </TD>
            <TD className="text-right pr-5 font-mono text-slate-900">
              {formatUsd(u.total, { decimals: 2 })}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

export default async function HealthPage(props: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await props.searchParams;
  const now = new Date();
  const { plan, period } = resolveF1PlanFromSearchParams(now, sp);
  const openAiWindow = parseOpenAiF1Window(sp.openaiWindow);
  const openAiSpendPlan = planOpenAiF1Spend({ now, period, pagePlan: plan, window: openAiWindow });
  const [data, ytdObserved] = await Promise.all([
    getF1Data(period, plan, openAiSpendPlan),
    loadProgramYtdObservedSpendUsd(prisma, now),
  ]);
  const m = data.plan.budgetMonthMultiplier;
  const openAiM = data.openAiSpendPlan.budgetMonthMultiplier;
  const combinedCreditsCap = OPENAI_TARGET_CREDITS_MONTH * openAiM;
  const combinedUsd = data.openAiSpend.combinedUsd;
  const combinedCreditsMtd = data.openAiSpend.credits.combinedCredits;
  const openAiChatgptCreditsMtd = data.openAiSpend.credits.chatgptCredits;
  const openAiCodexCreditsMtd = data.openAiSpend.credits.codexCredits;
  const openAiCreditsMode = data.openAiSpend.credits.mode;
  const openAiCombinedSource = data.openAiSpend.credits.combinedSource;
  const openAiBaselineUsdPeriod = OPENAI_POOLED_BASELINE_USD_MONTH * openAiM;
  const openAiOverageUsdPeriod = Math.max(0, combinedUsd - openAiBaselineUsdPeriod);
  const spendLabel = f1PeriodSpendLabel(period);
  const openAiSpendLabel = data.openAiSpendPlan.spendLabel;
  const openAiChatgptSpendSource = data.openAiSpend.sources.chatgpt;
  const codexSpendSource = data.openAiSpend.sources.codex;
  const programPlanningPeriodUsd = PROGRAM_MONTHLY_PLANNING_USD_TOTAL * m;
  const programPlanningYtdUsd = programPlanningYtdUsdForActuals(now);
  /** Copilot is EA prepaid — economic outlay follows commit, not gateway “usage USD”. */
  const observedProgramPeriodUsd = programObservedTotalUsd({
    byProduct: data.mtdMap,
    budgetMonthMultiplier: m,
  });
  const observedProgramYtdUsd = ytdObserved.totalUsd;
  const ytdVarianceUsd = observedProgramYtdUsd - programPlanningYtdUsd;
  const ytdProductRows = programYtdComparisonRows({ observed: ytdObserved, now });
  const annualizedActualUsd = annualizedProgramActualUsdForYtd({
    observedYtdUsd: observedProgramYtdUsd,
    planningYtdUsd: programPlanningYtdUsd,
  });
  const annualVarianceUsd = annualizedActualUsd - PROGRAM_ANNUAL_PLANNING_YTD_ACTUALS_USD;

  return (
    <>
      <Topbar
        title="Program Health"
        subtitle="F1 — Are we on track vs the program-level budgets?"
      />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-6 py-2.5">
        <F1PeriodRangeLine plan={data.plan} />
        <Suspense
          fallback={
            <span className="text-sm text-slate-500" aria-hidden>
              Period…
            </span>
          }
        >
          <HealthPeriodSelector />
        </Suspense>
      </div>
      <div className="p-6 space-y-6">
        <Card className="border-amber-200 bg-amber-50/40">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <CardTitle>OpenAI — ChatGPT and Codex</CardTitle>
                <CardDescription>
                  {OPENAI_CHATGPT_CODEX_ENTITLED_SEATS.toLocaleString()} entitled seats (
                  {OPENAI_CHATGPT_CODEX_LICENSES_ALLOTTED.toLocaleString()} allotted) ·{" "}
                  {formatCredits(OPENAI_POOLED_CREDITS_MONTH)} pooled +{" "}
                  {formatCredits(OPENAI_AVERAGE_OVERAGE_CREDITS_MONTH)} typical overage ={" "}
                  {formatCredits(OPENAI_TARGET_CREDITS_MONTH)}/mo ceiling ·{" "}
                  {formatUsd(OPENAI_LICENSE_USD_PER_SEAT_MONTH, { decimals: 0 })}/seat/mo license ·{" "}
                  {formatUsd(OPENAI_CREDIT_OVERAGE_USD, { decimals: 2 })}/credit overage
                </CardDescription>
              </div>
              <Suspense
                fallback={
                  <span className="text-sm text-slate-500 shrink-0" aria-hidden>
                    Window…
                  </span>
                }
              >
                <OpenAiF1WindowSelector className="shrink-0" />
              </Suspense>
            </div>
            <p className="text-xs text-slate-500 pt-1">{openAiSpendPlan.rangeDescription}</p>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <p className="text-sm font-medium text-slate-700">{openAiSpendLabel}</p>
              <div className="text-left sm:text-right">
                <div className="text-2xl font-semibold tabular-nums text-slate-900">
                  {formatCredits(combinedCreditsMtd)}
                </div>
                <div className="text-xs text-slate-500">
                  of {formatCredits(combinedCreditsCap)} planning credits
                </div>
              </div>
            </div>
            <BudgetBar
              spend={combinedCreditsMtd}
              budget={combinedCreditsCap}
              unit="credits"
              warnAt={0.9}
              progressLabel={openAiWindow === "billing" ? "Billing cycle" : spendLabel}
            />
            <p className="text-sm text-slate-600 tabular-nums">
              <span className="font-medium text-slate-800">
                {formatUsd(combinedUsd, { decimals: 0 })}
              </span>{" "}
              observed
              <span className="text-slate-400 mx-1.5" aria-hidden>
                ·
              </span>
              {formatUsd(openAiBaselineUsdPeriod, { decimals: 0 })} license baseline
              <span className="text-slate-400 mx-1.5" aria-hidden>
                ·
              </span>
              {formatUsd(openAiOverageUsdPeriod, { decimals: 0 })} overage
            </p>
            {openAiCombinedSource && openAiCombinedSource !== "workspace_analytics" ? (
              <p className="text-[11px] text-violet-700">
                Combined credits from{" "}
                {openAiCombinedSource === "org_costs"
                  ? "OpenAI Organization Costs API"
                  : openAiCombinedSource === "unified_credits"
                    ? "Unified Credits COSTS (compliance)"
                    : "billing-aligned vendor mirrors"}{" "}
                — aligned with OpenAI Admin Credits; Workspace Analytics alone can run lower.
              </p>
            ) : openAiCombinedSource === "workspace_analytics" ? (
              <p className="text-[11px] text-slate-500">
                Combined credits from Workspace Analytics org pool — may run below OpenAI Admin →
                Credits until org-costs or Unified Credits mirrors cover the period.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle>M365 Copilot (contract)</CardTitle>
            <CardDescription>
              EA prepaid commitment:{" "}
              <span className="font-medium text-slate-800">
                {M365_COPILOT_LICENSES_ENTITLED.toLocaleString()} licenses
              </span>{" "}
              at{" "}
              <span className="font-medium text-slate-800">
                {formatUsd(M365_COPILOT_USD_PER_LICENSE_YEAR, { decimals: 2 })} per license per year
              </span>
              . The full annual amount is owed regardless of usage (not API- or credit-metered like
              Cursor or OpenAI pooled credits). Program Health uses a level monthly line of{" "}
              <span className="font-medium text-slate-800">
                {formatUsd(M365_COPILOT_MONTHLY_COMMIT_USD)}/mo
              </span>{" "}
              (= {formatUsd(M365_COPILOT_ANNUAL_COMMIT_USD)}/yr).
            </CardDescription>
          </CardHeader>
        </Card>

        <Card className="border-slate-300 bg-gradient-to-br from-slate-50 to-white shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle>Total AI program cost (planning)</CardTitle>
            <CardDescription>
              Combined monthly envelopes from{" "}
              <code className="font-mono text-xs">lib/program.ts</code>
              : Cursor + ChatGPT/Codex (counted once) + Claude.ai + M365 Copilot. Prorated by the
              selected period; individual tiles below use the same lines.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Planning total · {data.plan.rangeDescription}
              </p>
              <p className="text-3xl font-semibold tabular-nums tracking-tight text-slate-900">
                {formatUsd(programPlanningPeriodUsd, { decimals: 0 })}
              </p>
              <p className="text-sm text-slate-600">
                Annual envelope (planned):{" "}
                <span className="font-medium text-slate-800 tabular-nums">
                  {formatUsd(PROGRAM_ANNUAL_PLANNING_USD_TOTAL, { decimals: 0 })}
                </span>
                /yr
              </p>
            </div>
            <ul className="text-sm text-slate-700 space-y-1.5 min-w-[min(100%,16rem)] sm:text-right">
              <li className="flex justify-between gap-8 sm:justify-end sm:gap-10">
                <span className="text-slate-600">Cursor</span>
                <span className="font-mono tabular-nums font-medium text-slate-900">
                  {formatUsd(MONTHLY_BUDGET_USD.CURSOR * m, { decimals: 0 })}
                </span>
              </li>
              <li className="flex justify-between gap-8 sm:justify-end sm:gap-10">
                <span className="text-slate-600">ChatGPT + Codex</span>
                <span className="font-mono tabular-nums font-medium text-slate-900">
                  {formatUsd(OPENAI_COMBINED_MONTHLY_PLANNING_USD * m, { decimals: 0 })}
                </span>
              </li>
              <li className="flex justify-between gap-8 sm:justify-end sm:gap-10">
                <span className="text-slate-600">Claude.ai</span>
                <span className="font-mono tabular-nums font-medium text-slate-900">
                  {formatUsd(MONTHLY_BUDGET_USD.CLAUDE_AI * m, { decimals: 0 })}
                </span>
              </li>
              <li className="flex justify-between gap-8 sm:justify-end sm:gap-10">
                <span className="text-slate-600">M365 Copilot</span>
                <span className="font-mono tabular-nums font-medium text-slate-900">
                  {formatUsd(MONTHLY_BUDGET_USD.M365_COPILOT * m, { decimals: 0 })}
                </span>
              </li>
            </ul>
          </CardContent>
          <CardContent className="pt-0 border-t border-slate-200/80 space-y-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-3">
                Calendar year · planned vs actual
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="text-xs text-slate-500">Planned (full year)</p>
                  <p className="text-xl font-semibold tabular-nums text-slate-900">
                    {formatUsd(PROGRAM_ANNUAL_PLANNING_USD_TOTAL, { decimals: 0 })}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">
                    Actual YTD · {ytdObserved.rangeDescription}
                  </p>
                  <p className="text-xl font-semibold tabular-nums text-slate-900">
                    {formatUsd(observedProgramYtdUsd, { decimals: 0 })}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    vs {formatUsd(programPlanningYtdUsd, { decimals: 0 })} prorated plan
                    <span
                      className={
                        ytdVarianceUsd > 0
                          ? " text-amber-800 font-medium"
                          : " text-emerald-800 font-medium"
                      }
                    >
                      {" "}
                      ({ytdVarianceUsd >= 0 ? "+" : ""}
                      {formatUsd(ytdVarianceUsd, { decimals: 0 })})
                    </span>
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Actual (annualized from YTD)</p>
                  <p className="text-xl font-semibold tabular-nums text-slate-900">
                    {formatUsd(annualizedActualUsd, { decimals: 0 })}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    vs {formatUsd(PROGRAM_ANNUAL_PLANNING_YTD_ACTUALS_USD, { decimals: 0 })} envelope
                    <span
                      className={
                        annualVarianceUsd > 0
                          ? " text-amber-800 font-medium"
                          : " text-emerald-800 font-medium"
                      }
                    >
                      {" "}
                      ({annualVarianceUsd >= 0 ? "+" : ""}
                      {formatUsd(annualVarianceUsd, { decimals: 0 })})
                    </span>
                  </p>
                </div>
                <div className="sm:col-span-2 lg:col-span-1">
                  <BudgetBar
                    spend={observedProgramYtdUsd}
                    budget={programPlanningYtdUsd}
                    progressLabel="Year to date"
                  />
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Actual YTD excludes Claude.ai (not yet in scope). Cursor actuals count from May 1,
                2026 only; prorated plan matches that window.
              </p>
              <div className="mt-4 rounded-lg border border-slate-100 bg-white p-4">
                <p className="text-xs font-medium text-slate-700 mb-1">By tool · actual vs prorated plan</p>
                <p className="text-[11px] text-slate-500 mb-3">
                  Calendar YTD through {ytdObserved.rangeDescription}. OpenAI plan split uses the
                  ChatGPT : Codex monthly budget ratio.
                </p>
                <YtdProductComparisonChart rows={ytdProductRows} />
              </div>
            </div>
            <p className="text-xs text-slate-600">
              <span className="font-medium text-slate-700">Period outlay (est.)</span> — Cursor,
              OpenAI, Claude from gateway or vendor; M365 Copilot at EA monthly commit (prepaid, not
              usage-metered in the mirror).{" "}
              <span className="font-mono tabular-nums text-slate-900">
                {formatUsd(observedProgramPeriodUsd, { decimals: 0 })}
              </span>{" "}
              · {spendLabel}
            </p>
          </CardContent>
        </Card>

        {/* Per-product cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {PRODUCTS.map(({ key, label }) => {
            const mtd = data.mtdMap.get(key) ?? 0;
            const budgetMonthly = MONTHLY_BUDGET_USD[key as ProductKey];
            const budgetPeriod = budgetMonthly * m;
            const isPrepaidCopilotTile = key === "M365_COPILOT";
            const isOpenAiProduct = key === "CHATGPT" || key === "CODEX";
            const mtdDisplay = isOpenAiProduct
              ? key === "CHATGPT"
                ? openAiChatgptCreditsMtd
                : openAiCodexCreditsMtd
              : mtd;
            const openAiCardTotalWeight = OPENAI_CARD_SPLIT.CHATGPT + OPENAI_CARD_SPLIT.CODEX;
            const openAiPlanningCreditsPeriod = OPENAI_TARGET_CREDITS_MONTH * openAiM;
            const openAiCardBudgetCredits =
              key === "CHATGPT"
                ? openAiPlanningCreditsPeriod * (OPENAI_CARD_SPLIT.CHATGPT / openAiCardTotalWeight)
                : openAiPlanningCreditsPeriod * (OPENAI_CARD_SPLIT.CODEX / openAiCardTotalWeight);
            const budgetDisplay = isOpenAiProduct ? openAiCardBudgetCredits : budgetPeriod;
            return (
              <Card key={key}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xs uppercase tracking-wider text-slate-500">
                      {label}
                    </CardTitle>
                    <Badge variant="outline">{key}</Badge>
                  </div>
                  <div className="text-2xl font-semibold text-slate-900 mt-1">
                    {isOpenAiProduct
                      ? formatCredits(mtdDisplay)
                      : formatUsd(isPrepaidCopilotTile ? budgetPeriod : mtd)}
                  </div>
                  <div className="text-xs text-slate-500">
                    {isOpenAiProduct
                      ? `of ${formatCredits(budgetDisplay)} planning credits · ${openAiSpendLabel}`
                      : isPrepaidCopilotTile
                        ? `Committed (prepaid) · ${spendLabel}`
                        : `of ${formatUsd(budgetPeriod)} · ${spendLabel}`}
                  </div>
                  {isOpenAiProduct ? (
                    <p className="text-[11px] text-slate-500 mt-1">
                      {key === "CHATGPT"
                        ? "Planning cap: 1:4 of org credit envelope. "
                        : "Planning cap: 3:4 of org credit envelope. "}
                      {openAiCreditsMode === "direct"
                        ? key === "CHATGPT"
                          ? openAiChatgptSpendSource === "unified_credits"
                            ? "Used credits from Unified Credits COSTS sync (ChatGPT product slice)."
                            : "Used credits = org pool (Workspace Analytics) minus Codex Enterprise usage."
                          : codexSpendSource === "unified_credits"
                            ? "Used credits from Unified Credits COSTS sync (Codex product slice)."
                            : "Used credits = Codex Enterprise Analytics for this period."
                        : "Used credits estimated from observed USD (pool + overage model)."}
                    </p>
                  ) : null}
                  {key === "CURSOR" && data.cursorSpendSource === "vendor" ? (
                    <p className="text-[11px] text-violet-700 mt-1">
                      Cursor Team Admin API (synced daily buckets)
                    </p>
                  ) : null}
                  {key === "CHATGPT" && openAiChatgptSpendSource === "vendor" ? (
                    <p className="text-[11px] text-violet-700 mt-1">
                      OpenAI organization costs API (line-item split)
                    </p>
                  ) : null}
                  {key === "CHATGPT" && openAiChatgptSpendSource === "manual_export" ? (
                    <p className="text-[11px] text-amber-800 mt-1">
                      ChatGPT Business users CSV (credits spread evenly per export day)
                    </p>
                  ) : null}
                  {key === "CHATGPT" && openAiChatgptSpendSource === "workspace_analytics" ? (
                    <p className="text-[11px] text-violet-700 mt-1">
                      Workspace Analytics API — daily CHATGPT_USER_ANALYTICS sync
                    </p>
                  ) : null}
                  {key === "CHATGPT" && openAiChatgptSpendSource === "unified_credits" ? (
                    <p className="text-[11px] text-violet-700 mt-1">
                      OpenAI Unified Credits COSTS — compliance sync (org-scoped, per-user)
                    </p>
                  ) : null}
                  {key === "CHATGPT" && openAiChatgptSpendSource === "unified_credits" ? (
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      Org costs API and Workspace Analytics sync remain for diagnostics; F1 uses
                      Unified Credits when mirrored.
                    </p>
                  ) : null}
                  {key === "CODEX" && codexSpendSource === "codex_enterprise_analytics_live" ? (
                    <p className="text-[11px] text-violet-700 mt-1">
                      Codex Enterprise Analytics — live API (mirror empty; api.chatgpt.com)
                    </p>
                  ) : null}
                  {key === "CODEX" && codexSpendSource === "codex_enterprise_analytics_sync" ? (
                    <p className="text-[11px] text-violet-700 mt-1">
                      Codex Enterprise Analytics — dashboard sync mirror (page load / cron)
                    </p>
                  ) : null}
                  {key === "CODEX" && codexSpendSource === "openai_org_costs" ? (
                    <p className="text-[11px] text-violet-700 mt-1">
                      OpenAI organization costs API (line-item split)
                    </p>
                  ) : null}
                  {key === "CODEX" && codexSpendSource === "manual_export" ? (
                    <p className="text-[11px] text-amber-800 mt-1">
                      Codex daily JSON export (workspace totals, or sessions aggregate)
                    </p>
                  ) : null}
                  {key === "CODEX" && codexSpendSource === "unified_credits" ? (
                    <p className="text-[11px] text-violet-700 mt-1">
                      OpenAI Unified Credits COSTS — compliance sync (org-scoped, per-user)
                    </p>
                  ) : null}
                  {key === "CODEX" && codexSpendSource === "unified_credits" ? (
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      Codex Enterprise Analytics and org costs API are superseded for F1 when Unified
                      Credits mirror rows exist.
                    </p>
                  ) : null}
                  {key === "M365_COPILOT" ? (
                    <p className="text-[11px] text-slate-500 mt-1">
                      {M365_COPILOT_LICENSES_ENTITLED.toLocaleString()} EA seats ×{" "}
                      {formatUsd(M365_COPILOT_USD_PER_LICENSE_YEAR, { decimals: 2 })}/yr — you owe
                      the level monthly charge regardless of usage. The gateway usage mirror often
                      stays at $0 because Copilot is prepaid, not metered as incremental API spend.
                    </p>
                  ) : null}
                </CardHeader>
                <CardContent>
                  {isPrepaidCopilotTile ? (
                    <div className="space-y-1.5">
                      <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full w-full rounded-full bg-sky-600" />
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-slate-500">
                        <span>Prepaid for this period</span>
                        <span className="font-mono tabular-nums text-slate-700">
                          {formatUsd(budgetPeriod, { decimals: 0 })}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <BudgetBar
                      spend={mtdDisplay}
                      budget={budgetDisplay}
                      unit={isOpenAiProduct ? "credits" : "usd"}
                      progressLabel={
                        isOpenAiProduct
                          ? openAiWindow === "billing"
                            ? "Billing cycle"
                            : spendLabel
                          : spendLabel
                      }
                    />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Spend trend chart */}
        <Card>
          <CardHeader>
            <CardTitle>{data.plan.chartTitle}</CardTitle>
            <CardDescription>
              {data.plan.rangeDescription}. Stacked across all 5 products. Gateway:{" "}
              <code className="font-mono">getGatewayClient().aggregateByProgramDaily()</code>
              . CURSOR uses{" "}
              {data.cursorSpendSource === "vendor"
                ? "Cursor Team Admin sync when VendorDailySpend rows exist."
                : "that mirror (Settings → sync Cursor spend for vendor totals). "}
              CHATGPT uses{" "}
              {openAiChatgptSpendSource === "unified_credits"
                ? "OpenAI Unified Credits COSTS compliance sync when VendorDailySpend rows exist for the period."
                : openAiChatgptSpendSource === "workspace_analytics"
                ? "Workspace Analytics API daily sync (CHATGPT_USER_ANALYTICS) when VendorDailySpend rows exist for the period."
                : openAiChatgptSpendSource === "vendor"
                  ? "OpenAI organization/costs when vendor rows exist; otherwise the gateway mirror."
                  : openAiChatgptSpendSource === "manual_export"
                    ? "uploaded ChatGPT users CSV (Settings → Data imports) when no newer vendor rows override it."
                    : "the gateway mirror unless Unified Credits, Workspace Analytics sync, or OpenAI org-costs sync has rows for this period."}{" "}
              CODEX uses{" "}
              {codexSpendSource === "unified_credits"
                ? "OpenAI Unified Credits COSTS compliance sync when VendorDailySpend rows exist for the period."
                : codexSpendSource === "codex_enterprise_analytics_live"
                ? "Codex Enterprise Analytics live from api.chatgpt.com when the VendorDailySpend mirror is empty."
                : codexSpendSource === "codex_enterprise_analytics_sync"
                  ? "Codex Enterprise Analytics from the dashboard sync mirror (hot-tier delta on open, hourly cron, or Refresh data)."
                  : codexSpendSource === "openai_org_costs"
                  ? "OpenAI organization/costs when vendor rows exist."
                  : codexSpendSource === "manual_export"
                    ? "uploaded Codex daily JSON (workspace preferred; sessions JSON fills spend if workspace is absent)."
                    : "the gateway mirror unless you run vendor sync in Settings."}
              {" "}
              Chart uses the page period; the OpenAI card above can switch to the billing cycle
              (16th–today) without changing Cursor or other tiles.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SpendTrendChart data={data.days} />
          </CardContent>
        </Card>

        {/* Top spenders — split by product family (mirror + vendor CSV/JSON per-user merge where applicable) */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Cursor — top 10 ({spendLabel.toLowerCase()})</CardTitle>
              <CardDescription>
                {data.cursorLeaderboardSource === "vendor"
                  ? "Per-user spend from Cursor Team Admin API (synced with Settings → Sync Cursor spend). Falls back to the gateway UsageRecord mirror when vendor rows are absent."
                  : "Sum of UsageRecord where product = CURSOR in this period. Run Settings → Sync Cursor spend to populate per-user rows from Cursor Team Admin."}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <LeaderboardTable rows={data.topCursor} emptyLabel="No Cursor usage in this period." />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>ChatGPT &amp; Codex — top 10 ({openAiSpendLabel.toLowerCase()})</CardTitle>
              <CardDescription>
                Gateway mirror for <code className="font-mono text-xs">CHATGPT</code> +{" "}
                <code className="font-mono text-xs">CODEX</code>, plus prorated vendor credits from
                overlapping <strong>ChatGPT Business users CSV</strong> and{" "}
                <strong>Codex sessions JSON</strong> (per-email <code className="font-mono text-xs">credit_total</code>
                ) imports. Codex workspace JSON and OpenAI org / Codex Enterprise syncs stay program-level
                for tiles, not this per-user blend.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <LeaderboardTable
                rows={data.topChatGptCodex}
                emptyLabel="No ChatGPT/Codex usage or import overlap in this period."
              />
            </CardContent>
          </Card>
        </div>

        <p className="text-xs text-slate-400">
          F1 reads gateway / Deel. With <code className="font-mono">INTEGRATION_CURSOR=real</code>{" "}
          and a recent Cursor spend sync, CURSOR tiles and the top-10 leaderboard use Cursor Team
          Admin per-user rows (<code className="font-mono">VendorUserDailySpend</code>). With{" "}
          <code className="font-mono">INTEGRATION_OPENAI=real</code> and OpenAI
          costs sync, CHATGPT can track organization costs. With{" "}
          <code className="font-mono">INTEGRATION_CODEX_ENTERPRISE_ANALYTICS=real</code>, the CODEX
          tile loads workspace usage live from <code className="font-mono">api.chatgpt.com</code> on
          each Health view (VendorDailySpend sync is a fallback).           The ChatGPT &amp; Codex leaderboard uses the OpenAI card window (page period or billing
          cycle). Page period “This month” is calendar month for all products; pick{" "}
          <span className="font-medium text-slate-500">Current billing cycle</span> on the OpenAI
          card to align ChatGPT/Codex tiles with the 16th-renewal invoice window.
        </p>
      </div>
    </>
  );
}
