import { Suspense } from "react";
import { Topbar } from "@/components/dashboard/topbar";
import { HealthPeriodSelector } from "@/components/dashboard/health-period-selector";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { BudgetBar } from "@/components/charts/budget-bar";
import { SpendTrendChart, type SpendPoint } from "@/components/charts/spend-trend-chart";
import {
  COMBINED_CHATGPT_CODEX_CAP_MONTH,
  OPENAI_AVERAGE_OVERAGE_CREDITS_MONTH,
  OPENAI_POOLED_CREDITS_MONTH,
  OPENAI_TARGET_CREDITS_MONTH,
  MONTHLY_BUDGET_USD,
  OPENAI_CHATGPT_CODEX_ENTITLED_SEATS,
  OPENAI_CHATGPT_CODEX_LICENSES_ALLOTTED,
  OPENAI_CREDIT_OVERAGE_USD,
  OPENAI_POOLED_CREDITS_PER_USER_MONTH,
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
  const combinedCreditsMtd = data.combinedChatGptCodexMtd / OPENAI_CREDIT_OVERAGE_USD;
  const spendLabel = f1PeriodSpendLabel(period);

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
              . The credit pool is sized for the entitled count:{" "}
              <span className="font-medium text-slate-800">
                {OPENAI_POOLED_CREDITS_PER_USER_MONTH.toLocaleString()} credits per entitled user per
                month
              </span>
              , pooled org-wide. Usage beyond the pool bills at{" "}
              <span className="font-medium text-slate-800">
                {formatUsd(OPENAI_CREDIT_OVERAGE_USD, { decimals: 2 })} per credit
              </span>{" "}
              under the WDTS agreement.
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
              <p className="font-medium text-slate-900">Illustrative overage</p>
              <p className="mt-1 text-slate-700">
                Typical planning includes{" "}
                <span className="font-mono font-medium">
                  {OPENAI_AVERAGE_OVERAGE_CREDITS_MONTH.toLocaleString()}
                </span>{" "}
                overage credits above pooled entitlement, which yields{" "}
                <span className="font-mono font-medium">
                  {OPENAI_TARGET_CREDITS_MONTH.toLocaleString()}
                </span>{" "}
                total credits/month planning envelope. At{" "}
                {formatUsd(OPENAI_CREDIT_OVERAGE_USD, { decimals: 2 })}/credit is about{" "}
                <span className="font-semibold text-slate-900">
                  {formatUsd(COMBINED_CHATGPT_CODEX_CAP_MONTH)}
                </span>{" "}
                / month.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Combined cap callout */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>ChatGPT + Codex combined cap</CardTitle>
                <CardDescription>
                  {formatCredits(OPENAI_TARGET_CREDITS_MONTH)}/month planning envelope ({formatCredits(
                    OPENAI_POOLED_CREDITS_MONTH,
                  )} pooled + {formatCredits(OPENAI_AVERAGE_OVERAGE_CREDITS_MONTH)} average overage).
                  USD equivalent at {formatUsd(OPENAI_CREDIT_OVERAGE_USD, { decimals: 2 })}/credit:{" "}
                  {formatUsd(COMBINED_CHATGPT_CODEX_CAP_MONTH)}/month.
                </CardDescription>
              </div>
              <div className="text-right">
                <div className="text-2xl font-semibold">
                  {formatCredits(combinedCreditsMtd)}
                </div>
                <div className="text-xs text-slate-500">
                  of {formatCredits(combinedCreditsCap)} · {spendLabel}
                </div>
                <div className="text-[11px] text-slate-500">
                  (~{formatUsd(data.combinedChatGptCodexMtd, { decimals: 0 })} at{" "}
                  {formatUsd(OPENAI_CREDIT_OVERAGE_USD, { decimals: 2 })}/credit)
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <BudgetBar
              spend={combinedCreditsMtd}
              budget={combinedCreditsCap}
              unit="credits"
              warnAt={0.9}
            />
          </CardContent>
        </Card>

        {/* Per-product cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {PRODUCTS.map(({ key, label }) => {
            const mtd = data.mtdMap.get(key) ?? 0;
            const budgetMonthly = MONTHLY_BUDGET_USD[key as ProductKey];
            const budgetPeriod = budgetMonthly * m;
            const isOpenAiProduct = key === "CHATGPT" || key === "CODEX";
            const mtdDisplay = isOpenAiProduct ? mtd / OPENAI_CREDIT_OVERAGE_USD : mtd;
            const openAiCardTotalWeight = OPENAI_CARD_SPLIT.CHATGPT + OPENAI_CARD_SPLIT.CODEX;
            const openAiPooledCreditsPeriod = OPENAI_POOLED_CREDITS_MONTH * m;
            const openAiCardBudgetCredits =
              key === "CHATGPT"
                ? openAiPooledCreditsPeriod * (OPENAI_CARD_SPLIT.CHATGPT / openAiCardTotalWeight)
                : openAiPooledCreditsPeriod * (OPENAI_CARD_SPLIT.CODEX / openAiCardTotalWeight);
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
                      ? `of ${formatCredits(budgetDisplay)} pooled credits · ${spendLabel}`
                      : `of ${formatUsd(budgetPeriod)} · ${spendLabel}`}
                  </div>
                  {key === "CHATGPT" ? (
                    <p className="text-[11px] text-slate-500 mt-1">
                      Card allocation from pooled credits: ChatGPT:Codex = 1:3
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
