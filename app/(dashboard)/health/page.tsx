import { Suspense } from "react";
import { Topbar } from "@/components/dashboard/topbar";
import { HealthPeriodSelector } from "@/components/dashboard/health-period-selector";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { BudgetBar } from "@/components/charts/budget-bar";
import { SpendTrendChart, type SpendPoint } from "@/components/charts/spend-trend-chart";
import {
  OPENAI_AVERAGE_OVERAGE_CREDITS_MONTH,
  OPENAI_POOLED_CREDITS_MONTH,
  OPENAI_TARGET_CREDITS_MONTH,
  MONTHLY_BUDGET_USD,
  OPENAI_CHATGPT_CODEX_ENTITLED_SEATS,
  OPENAI_CHATGPT_CODEX_LICENSES_ALLOTTED,
  OPENAI_CREDIT_OVERAGE_USD,
  OPENAI_POOLED_CREDITS_PER_USER_MONTH,
  OPENAI_LICENSE_USD_PER_SEAT_MONTH,
  OPENAI_POOLED_BASELINE_USD_MONTH,
  OPENAI_PLANNED_OVERAGE_USD_MONTH,
  OPENAI_COMBINED_MONTHLY_PLANNING_USD,
  OPENAI_ANNUAL_BASELINE_USD,
  OPENAI_ANNUAL_PLANNED_OVERAGE_USD,
  openAiCombinedCreditsUsedEstimate,
  PROGRAM_MONTHLY_PLANNING_USD_TOTAL,
  PROGRAM_ANNUAL_PLANNING_USD_TOTAL,
  M365_COPILOT_LICENSES_ENTITLED,
  M365_COPILOT_USD_PER_LICENSE_YEAR,
  M365_COPILOT_ANNUAL_COMMIT_USD,
  M365_COPILOT_MONTHLY_COMMIT_USD,
  PRODUCTS,
  type ProductKey,
} from "@/lib/program";
import { formatUsd } from "@/lib/utils";
import { getAzureADClient, getDeelClient, getGatewayClient } from "@/lib/integrations";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadCursorVendorSpendForF1, mergeCursorVendorIntoF1 } from "@/lib/f1-cursor-vendor";
import { loadOpenAiVendorSpendForF1, mergeOpenAiVendorIntoF1 } from "@/lib/f1-openai-vendor";
import {
  loadCodexEnterpriseVendorSpendForF1,
  mergeCodexEnterpriseVendorIntoF1,
} from "@/lib/f1-codex-enterprise-analytics";
import {
  loadManualVendorExportSpendForF1,
  mergeManualVendorExportIntoF1,
} from "@/lib/f1-manual-vendor-export";
import {
  f1PeriodSpendLabel,
  resolveF1PlanFromSearchParams,
  type F1Period,
  type F1PeriodPlan,
} from "@/lib/f1-period";

export const dynamic = "force-dynamic";

type SP = { period?: string; from?: string; to?: string };

function formatCredits(n: number): string {
  return `${Math.max(n, 0).toLocaleString("en-US", { maximumFractionDigits: 0 })} credits`;
}

const OPENAI_CARD_SPLIT = {
  CHATGPT: 1,
  CODEX: 3,
} as const;

async function getF1Data(period: F1Period, plan: F1PeriodPlan): Promise<{
  mtdMap: Map<ProductKey, number>;
  days: SpendPoint[];
  top: {
    id: string;
    displayName: string;
    email: string;
    roleTag: string;
    region: string;
    total: number;
  }[];
  combinedChatGptCodexMtd: number;
  plan: F1PeriodPlan;
  period: F1Period;
  cursorSpendSource: "gateway" | "vendor";
  openAiChatgptSpendSource: "gateway" | "vendor" | "manual_export";
  codexSpendSource:
    | "gateway"
    | "openai_org_costs"
    | "codex_enterprise_analytics"
    | "manual_export";
}> {
  const gateway = getGatewayClient();
  const azuread = getAzureADClient();
  const deel = getDeelClient();

  const [
    programAgg,
    dailyAgg,
    topRaw,
    identityAll,
    deelAll,
    vendorCursor,
    vendorManualExport,
    vendorOpenAi,
    vendorCodexEnterprise,
  ] = await Promise.all([
    gateway.aggregateByProgram({ periodStart: plan.periodStart, periodEnd: plan.periodEnd }),
    gateway.aggregateByProgramDaily({ since: plan.periodStart, until: plan.periodEnd }),
    gateway.topSpenders({ periodStart: plan.periodStart, periodEnd: plan.periodEnd, limit: 10 }),
    azuread.listUsers(),
    deel.listEmployees(),
    loadCursorVendorSpendForF1(prisma, {
      periodStart: plan.periodStart,
      periodEnd: plan.periodEnd,
    }),
    loadManualVendorExportSpendForF1(prisma, {
      periodStart: plan.periodStart,
      periodEnd: plan.periodEnd,
    }),
    loadOpenAiVendorSpendForF1(prisma, {
      periodStart: plan.periodStart,
      periodEnd: plan.periodEnd,
    }),
    loadCodexEnterpriseVendorSpendForF1(prisma, {
      periodStart: plan.periodStart,
      periodEnd: plan.periodEnd,
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
  mergeManualVendorExportIntoF1({
    mtdMap,
    days,
    chatgpt: vendorManualExport.chatgpt,
    codex: vendorManualExport.codex,
  });
  mergeOpenAiVendorIntoF1({
    mtdMap,
    days,
    chatgptVendorTotal: vendorOpenAi.chatgpt.periodTotalUsd,
    chatgptByChartDay: vendorOpenAi.chatgpt.byChartDay,
    useChatgptVendor: vendorOpenAi.chatgpt.usedVendor,
    codexVendorTotal: vendorOpenAi.codex.periodTotalUsd,
    codexByChartDay: vendorOpenAi.codex.byChartDay,
    useCodexVendor: vendorOpenAi.codex.usedVendor,
  });
  mergeCodexEnterpriseVendorIntoF1({
    mtdMap,
    days,
    codexVendorTotal: vendorCodexEnterprise.periodTotalUsd,
    codexByChartDay: vendorCodexEnterprise.byChartDay,
    useVendor: vendorCodexEnterprise.usedVendor,
  });
  const cursorSpendSource: "gateway" | "vendor" = vendorCursor.usedVendor
    ? "vendor"
    : "gateway";
  let openAiChatgptSpendSource: "gateway" | "vendor" | "manual_export" = "gateway";
  if (vendorManualExport.chatgpt.used) openAiChatgptSpendSource = "manual_export";
  if (vendorOpenAi.chatgpt.usedVendor) openAiChatgptSpendSource = "vendor";

  let codexSpendSource:
    | "gateway"
    | "openai_org_costs"
    | "codex_enterprise_analytics"
    | "manual_export" = "gateway";
  if (vendorManualExport.codex.used) codexSpendSource = "manual_export";
  if (vendorOpenAi.codex.usedVendor) codexSpendSource = "openai_org_costs";
  if (vendorCodexEnterprise.usedVendor) codexSpendSource = "codex_enterprise_analytics";

  const identityById = new Map(identityAll.map((u) => [u.azureObjectId, u]));
  const deelByEmail = new Map(deelAll.map((d) => [d.email, d]));
  const top = topRaw
    .map((r) => {
      const id = identityById.get(r.userId);
      const hr = id ? deelByEmail.get(id.email) : undefined;
      if (!id) return null;
      return {
        id: r.userId,
        displayName: id.displayName,
        email: id.email,
        roleTag: hr?.roleTag ?? "—",
        region: hr?.region ?? "—",
        total: r.totalUsd,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r != null);

  return {
    mtdMap,
    days,
    top,
    combinedChatGptCodexMtd:
      (mtdMap.get("CHATGPT") ?? 0) + (mtdMap.get("CODEX") ?? 0),
    plan,
    period,
    cursorSpendSource,
    openAiChatgptSpendSource,
    codexSpendSource,
  };
}

export default async function HealthPage(props: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await props.searchParams;
  const now = new Date();
  const { plan, period } = resolveF1PlanFromSearchParams(now, sp);
  const data = await getF1Data(period, plan);
  const m = data.plan.budgetMonthMultiplier;
  const combinedCreditsCap = OPENAI_TARGET_CREDITS_MONTH * m;
  const combinedUsd = data.combinedChatGptCodexMtd;
  const combinedCreditsMtd = openAiCombinedCreditsUsedEstimate({
    periodSpendUsd: combinedUsd,
    budgetMonthMultiplier: m,
  });
  const openAiChatgptUsd = data.mtdMap.get("CHATGPT") ?? 0;
  const openAiChatgptCreditsMtd =
    combinedUsd <= 0 ? 0 : combinedCreditsMtd * (openAiChatgptUsd / combinedUsd);
  /** Remainder so ChatGPT + Codex credit bars sum to the combined card (no float drift). */
  const openAiCodexCreditsMtd = combinedUsd <= 0 ? 0 : combinedCreditsMtd - openAiChatgptCreditsMtd;
  const openAiBaselineUsdPeriod = OPENAI_POOLED_BASELINE_USD_MONTH * m;
  const openAiOverageUsdPeriod = Math.max(0, combinedUsd - openAiBaselineUsdPeriod);
  const spendLabel = f1PeriodSpendLabel(period);
  const programPlanningPeriodUsd = PROGRAM_MONTHLY_PLANNING_USD_TOTAL * m;
  const observedProgramPeriodUsd = PRODUCTS.reduce(
    (acc, { key }) => acc + (data.mtdMap.get(key) ?? 0),
    0,
  );

  return (
    <>
      <Topbar
        title="Program Health"
        subtitle="F1 — Are we on track vs the program-level budgets?"
      />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-6 py-2.5">
        <p className="text-sm text-slate-600">{data.plan.rangeDescription}</p>
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
          <CardHeader>
            <CardTitle>OpenAI — ChatGPT and Codex (contract)</CardTitle>
            <CardDescription>
              Policy inventory:{" "}
              <span className="font-medium text-slate-800">
                {OPENAI_CHATGPT_CODEX_ENTITLED_SEATS.toLocaleString()} entitled seats
              </span>{" "}
              (ChatGPT + Codex),{" "}
              <span className="font-medium text-slate-800">
                {OPENAI_CHATGPT_CODEX_LICENSES_ALLOTTED.toLocaleString()} licenses allotted
              </span>
              . Pooled credits:{" "}
              <span className="font-medium text-slate-800">
                {OPENAI_POOLED_CREDITS_PER_USER_MONTH.toLocaleString()} credits per seat per month
              </span>{" "}
              (= {formatCredits(OPENAI_POOLED_CREDITS_MONTH)}/mo org-wide). License line:{" "}
              <span className="font-medium text-slate-800">
                {formatUsd(OPENAI_LICENSE_USD_PER_SEAT_MONTH, { decimals: 0 })} per seat per month
              </span>{" "}
              ({formatUsd(OPENAI_POOLED_BASELINE_USD_MONTH)}/mo for {OPENAI_CHATGPT_CODEX_ENTITLED_SEATS}{" "}
              seats). Overage credits bill at{" "}
              <span className="font-medium text-slate-800">
                {formatUsd(OPENAI_CREDIT_OVERAGE_USD, { decimals: 2 })} per credit
              </span>
              .
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-700">
              <p className="font-medium text-slate-900">Pooled credits (policy basis)</p>
              <p className="mt-1 font-mono text-slate-800">
                {OPENAI_CHATGPT_CODEX_ENTITLED_SEATS.toLocaleString()} ×{" "}
                {OPENAI_POOLED_CREDITS_PER_USER_MONTH.toLocaleString()} ={" "}
                {OPENAI_POOLED_CREDITS_MONTH.toLocaleString()}{" "}
                credits / month (before overage)
              </p>
            </div>
            <div className="rounded-lg border border-amber-300/80 bg-white/80 px-4 py-3 text-sm text-slate-800">
              <p className="font-medium text-slate-900">Planning envelope (credits + USD)</p>
              <p className="mt-1 text-slate-700">
                Typical overage:{" "}
                <span className="font-mono font-medium">
                  {OPENAI_AVERAGE_OVERAGE_CREDITS_MONTH.toLocaleString()}
                </span>{" "}
                credits/mo × {formatUsd(OPENAI_CREDIT_OVERAGE_USD, { decimals: 2 })} ={" "}
                <span className="font-semibold text-slate-900">
                  {formatUsd(OPENAI_PLANNED_OVERAGE_USD_MONTH)}/mo
                </span>{" "}
                (~{formatUsd(OPENAI_ANNUAL_PLANNED_OVERAGE_USD)}/yr). With the pool:{" "}
                <span className="font-mono font-medium">
                  {OPENAI_TARGET_CREDITS_MONTH.toLocaleString()}
                </span>{" "}
                credits/mo planning ceiling and{" "}
                <span className="font-semibold text-slate-900">
                  {formatUsd(OPENAI_COMBINED_MONTHLY_PLANNING_USD)}/mo
                </span>{" "}
                total ({formatUsd(OPENAI_POOLED_BASELINE_USD_MONTH)} baseline +{" "}
                {formatUsd(OPENAI_PLANNED_OVERAGE_USD_MONTH)} typical overage). Annual baseline:{" "}
                <span className="font-semibold">{formatUsd(OPENAI_ANNUAL_BASELINE_USD)}</span>.
              </p>
            </div>
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

        {/* Combined cap callout */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>ChatGPT + Codex — credits vs planning</CardTitle>
                <CardDescription>
                  Credit bar: {formatCredits(OPENAI_POOLED_CREDITS_MONTH)} pooled +{" "}
                  {formatCredits(OPENAI_AVERAGE_OVERAGE_CREDITS_MONTH)} typical overage ={" "}
                  {formatCredits(OPENAI_TARGET_CREDITS_MONTH)}/month ceiling. Usage credits are
                  estimated from observed spend (in-pool spend scales within the pool; above{" "}
                  {formatUsd(OPENAI_POOLED_BASELINE_USD_MONTH)} adds credits at{" "}
                  {formatUsd(OPENAI_CREDIT_OVERAGE_USD, { decimals: 2 })}/credit).
                </CardDescription>
              </div>
              <div className="text-right shrink-0">
                <div className="text-2xl font-semibold tabular-nums">
                  {formatCredits(combinedCreditsMtd)}
                </div>
                <div className="text-xs text-slate-500">
                  of {formatCredits(combinedCreditsCap)} · {spendLabel}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <BudgetBar
              spend={combinedCreditsMtd}
              budget={combinedCreditsCap}
              unit="credits"
              warnAt={0.9}
            />
            <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-800 space-y-2">
              <p className="font-medium text-slate-900">USD view ({spendLabel.toLowerCase()})</p>
              <ul className="space-y-1 text-slate-700 list-disc pl-5">
                <li>
                  License baseline (prorated):{" "}
                  <span className="font-mono font-medium text-slate-900">
                    {formatUsd(openAiBaselineUsdPeriod, { decimals: 0 })}
                  </span>{" "}
                  ({OPENAI_CHATGPT_CODEX_ENTITLED_SEATS} × {formatUsd(OPENAI_LICENSE_USD_PER_SEAT_MONTH, { decimals: 0 })}
                  /mo × period)
                </li>
                <li>
                  Spend above baseline (overage at {formatUsd(OPENAI_CREDIT_OVERAGE_USD, { decimals: 2 })}/credit):{" "}
                  <span className="font-mono font-medium text-slate-900">
                    {formatUsd(openAiOverageUsdPeriod, { decimals: 0 })}
                  </span>
                </li>
                <li>
                  <span className="font-medium text-slate-900">Observed total</span> (gateway / vendor):{" "}
                  <span className="font-mono font-semibold text-slate-900">
                    {formatUsd(combinedUsd, { decimals: 0 })}
                  </span>
                </li>
              </ul>
              <p className="text-xs text-slate-500 pt-1 border-t border-slate-200">
                Annual planning: {formatUsd(OPENAI_ANNUAL_BASELINE_USD)} baseline + ~{" "}
                {formatUsd(OPENAI_ANNUAL_PLANNED_OVERAGE_USD)} typical overage ≈{" "}
                {formatUsd(OPENAI_ANNUAL_BASELINE_USD + OPENAI_ANNUAL_PLANNED_OVERAGE_USD)} combined.
              </p>
            </div>
          </CardContent>
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
                Annual run-rate:{" "}
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
          <CardContent className="pt-0 border-t border-slate-200/80">
            <p className="text-xs text-slate-600">
              <span className="font-medium text-slate-700">Observed spend</span> this period (all
              products, gateway / vendor):{" "}
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
            const isOpenAiProduct = key === "CHATGPT" || key === "CODEX";
            const mtdDisplay = isOpenAiProduct
              ? key === "CHATGPT"
                ? openAiChatgptCreditsMtd
                : openAiCodexCreditsMtd
              : mtd;
            const openAiCardTotalWeight = OPENAI_CARD_SPLIT.CHATGPT + OPENAI_CARD_SPLIT.CODEX;
            const openAiPlanningCreditsPeriod = OPENAI_TARGET_CREDITS_MONTH * m;
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
                    {isOpenAiProduct ? formatCredits(mtdDisplay) : formatUsd(mtd)}
                  </div>
                  <div className="text-xs text-slate-500">
                    {isOpenAiProduct
                      ? `of ${formatCredits(budgetDisplay)} planning credits · ${spendLabel}`
                      : `of ${formatUsd(budgetPeriod)} · ${spendLabel}`}
                  </div>
                  {isOpenAiProduct ? (
                    <p className="text-[11px] text-slate-500 mt-1">
                      {key === "CHATGPT"
                        ? "Planning cap: 1:4 of org credit envelope. "
                        : "Planning cap: 3:4 of org credit envelope. "}
                      Used credits = this product&apos;s USD share × combined estimate (pool + overage
                      model above).
                    </p>
                  ) : null}
                  {key === "CURSOR" && data.cursorSpendSource === "vendor" ? (
                    <p className="text-[11px] text-violet-700 mt-1">
                      Cursor Team Admin API (synced daily buckets)
                    </p>
                  ) : null}
                  {key === "CHATGPT" && data.openAiChatgptSpendSource === "vendor" ? (
                    <p className="text-[11px] text-violet-700 mt-1">
                      OpenAI organization costs API (line-item split)
                    </p>
                  ) : null}
                  {key === "CHATGPT" && data.openAiChatgptSpendSource === "manual_export" ? (
                    <p className="text-[11px] text-amber-800 mt-1">
                      ChatGPT Business users CSV (credits spread evenly per export day)
                    </p>
                  ) : null}
                  {key === "CODEX" && data.codexSpendSource === "codex_enterprise_analytics" ? (
                    <p className="text-[11px] text-violet-700 mt-1">
                      Codex Enterprise Analytics (api.chatgpt.com)
                    </p>
                  ) : null}
                  {key === "CODEX" && data.codexSpendSource === "openai_org_costs" ? (
                    <p className="text-[11px] text-violet-700 mt-1">
                      OpenAI organization costs API (line-item split)
                    </p>
                  ) : null}
                  {key === "CODEX" && data.codexSpendSource === "manual_export" ? (
                    <p className="text-[11px] text-amber-800 mt-1">
                      Codex daily JSON export (workspace totals, or sessions aggregate)
                    </p>
                  ) : null}
                  {key === "M365_COPILOT" ? (
                    <p className="text-[11px] text-slate-500 mt-1">
                      Prepaid seats ({M365_COPILOT_LICENSES_ENTITLED} ×{" "}
                      {formatUsd(M365_COPILOT_USD_PER_LICENSE_YEAR, { decimals: 2 })}/yr); bar
                      compares gateway-reported activity to a level monthly commit, not marginal
                      per-call cost.
                    </p>
                  ) : null}
                </CardHeader>
                <CardContent>
                  <BudgetBar
                    spend={mtdDisplay}
                    budget={budgetDisplay}
                    unit={isOpenAiProduct ? "credits" : "usd"}
                  />
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
              {data.openAiChatgptSpendSource === "vendor"
                ? "OpenAI organization/costs when vendor rows exist; otherwise the gateway mirror."
                : data.openAiChatgptSpendSource === "manual_export"
                  ? "uploaded ChatGPT users CSV (Settings → Data imports) when no OpenAI vendor rows override it."
                  : "the gateway mirror unless you run OpenAI vendor sync in Settings."}{" "}
              CODEX uses{" "}
              {data.codexSpendSource === "codex_enterprise_analytics"
                ? "Codex Enterprise Analytics sync when configured (overrides org costs for the CODEX tile)."
                : data.codexSpendSource === "openai_org_costs"
                  ? "OpenAI organization/costs when vendor rows exist."
                  : data.codexSpendSource === "manual_export"
                    ? "uploaded Codex daily JSON (workspace preferred; sessions JSON fills spend if workspace is absent)."
                    : "the gateway mirror unless you run vendor sync in Settings."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SpendTrendChart data={data.days} />
          </CardContent>
        </Card>

        {/* Top 10 spenders */}
        <Card>
          <CardHeader>
            <CardTitle>Top 10 spenders ({spendLabel.toLowerCase()})</CardTitle>
            <CardDescription>Across all products combined.</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <Table>
              <THead>
                <TR>
                  <TH className="px-5">User</TH>
                  <TH>Email</TH>
                  <TH>Role tag</TH>
                  <TH>Region</TH>
                  <TH className="text-right pr-5">Period spend</TH>
                </TR>
              </THead>
              <TBody>
                {data.top.map((u) => (
                  <TR key={u.id}>
                    <TD className="pl-5 font-medium text-slate-900">{u.displayName}</TD>
                    <TD className="text-slate-600">{u.email}</TD>
                    <TD>
                      <Badge variant="secondary">{u.roleTag}</Badge>
                    </TD>
                    <TD>
                      <Badge variant={u.region === "apac-mo" ? "warning" : "outline"}>
                        {u.region}
                      </Badge>
                    </TD>
                    <TD className="text-right pr-5 font-mono text-slate-900">
                      {formatUsd(u.total, { decimals: 2 })}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <p className="text-xs text-slate-400">
          F1 reads gateway / AzureAD / Deel. With <code className="font-mono">INTEGRATION_CURSOR=real</code>{" "}
          and a recent <code className="font-mono">VendorDailySpend</code> sync, CURSOR matches Cursor
          Team Admin usage.           With <code className="font-mono">INTEGRATION_OPENAI=real</code> and OpenAI costs sync,
          CHATGPT can track organization costs. With{" "}
          <code className="font-mono">INTEGRATION_CODEX_ENTERPRISE_ANALYTICS=real</code> and Codex
          analytics sync, the CODEX tile can use <code className="font-mono">api.chatgpt.com</code>{" "}
          workspace usage (overriding org-costs CODEX when both exist).
        </p>
      </div>
    </>
  );
}
