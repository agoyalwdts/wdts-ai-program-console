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
  MONTHLY_BUDGET_USD,
  OPENAI_CHATGPT_CODEX_ENTITLED_SEATS,
  OPENAI_CHATGPT_CODEX_LICENSES_ALLOTTED,
  OPENAI_CREDIT_OVERAGE_USD,
  OPENAI_ILLUSTRATIVE_CREDITS_OVER_MONTH,
  OPENAI_ILLUSTRATIVE_OVERAGE_CHARGE_USD_MONTH,
  OPENAI_POOLED_CREDITS_PER_USER_MONTH,
  PRODUCTS,
  type ProductKey,
} from "@/lib/program";
import { formatUsd } from "@/lib/utils";
import { getAzureADClient, getDeelClient, getGatewayClient } from "@/lib/integrations";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadCursorVendorSpendForF1, mergeCursorVendorIntoF1 } from "@/lib/f1-cursor-vendor";
import {
  f1PeriodSpendLabel,
  parseF1Period,
  planF1Period,
  type F1Period,
  type F1PeriodPlan,
} from "@/lib/f1-period";

export const dynamic = "force-dynamic";

type SP = { period?: string };

async function getF1Data(period: F1Period): Promise<{
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
}> {
  const now = new Date();
  const plan = planF1Period(now, period);

  const gateway = getGatewayClient();
  const azuread = getAzureADClient();
  const deel = getDeelClient();

  const [programAgg, dailyAgg, topRaw, identityAll, deelAll, vendorCursor] = await Promise.all([
    gateway.aggregateByProgram({ periodStart: plan.periodStart, periodEnd: plan.periodEnd }),
    gateway.aggregateByProgramDaily({ since: plan.periodStart, until: plan.periodEnd }),
    gateway.topSpenders({ periodStart: plan.periodStart, periodEnd: plan.periodEnd, limit: 10 }),
    azuread.listUsers(),
    deel.listEmployees(),
    loadCursorVendorSpendForF1(prisma, {
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
  const cursorSpendSource: "gateway" | "vendor" = vendorCursor.usedVendor
    ? "vendor"
    : "gateway";

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
  };
}

export default async function HealthPage(props: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await props.searchParams;
  const period = parseF1Period(sp.period);
  const data = await getF1Data(period);
  const m = data.plan.budgetMonthMultiplier;
  const combinedPeriodCap = COMBINED_CHATGPT_CODEX_CAP_MONTH * m;
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
                {(OPENAI_CHATGPT_CODEX_ENTITLED_SEATS * OPENAI_POOLED_CREDITS_PER_USER_MONTH).toLocaleString()}{" "}
                credits / month (before overage)
              </p>
            </div>
            <div className="rounded-lg border border-amber-300/80 bg-white/80 px-4 py-3 text-sm text-slate-800">
              <p className="font-medium text-slate-900">Illustrative overage</p>
              <p className="mt-1 text-slate-700">
                If the org runs{" "}
                <span className="font-mono font-medium">
                  {OPENAI_ILLUSTRATIVE_CREDITS_OVER_MONTH.toLocaleString()}
                </span>{" "}
                credits over the pooled allowance in a month, overage at{" "}
                {formatUsd(OPENAI_CREDIT_OVERAGE_USD, { decimals: 2 })}/credit is about{" "}
                <span className="font-semibold text-slate-900">
                  {formatUsd(OPENAI_ILLUSTRATIVE_OVERAGE_CHARGE_USD_MONTH)}
                </span>{" "}
                for that month (
                {OPENAI_ILLUSTRATIVE_CREDITS_OVER_MONTH.toLocaleString()} ×{" "}
                {formatUsd(OPENAI_CREDIT_OVERAGE_USD, { decimals: 2 })}).
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
                  {formatUsd(COMBINED_CHATGPT_CODEX_CAP_MONTH)}/month program operating envelope
                  ({OPENAI_CHATGPT_CODEX_ENTITLED_SEATS.toLocaleString()} entitled ×{" "}
                  {formatUsd(OPENAI_POOLED_CREDITS_PER_USER_MONTH, { decimals: 0 })} planning line,
                  policy). User-level caps can overcommit; aggregate spend is managed to this
                  envelope alongside the OpenAI credit pool and overage rate above.
                </CardDescription>
              </div>
              <div className="text-right">
                <div className="text-2xl font-semibold">
                  {formatUsd(data.combinedChatGptCodexMtd)}
                </div>
                <div className="text-xs text-slate-500">
                  of {formatUsd(combinedPeriodCap)} · {spendLabel}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <BudgetBar
              spend={data.combinedChatGptCodexMtd}
              budget={combinedPeriodCap}
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
                    {formatUsd(mtd)}
                  </div>
                  <div className="text-xs text-slate-500">
                    of {formatUsd(budgetPeriod)} · {spendLabel}
                  </div>
                  {key === "CURSOR" && data.cursorSpendSource === "vendor" ? (
                    <p className="text-[11px] text-violet-700 mt-1">
                      Cursor Team Admin API (synced daily buckets)
                    </p>
                  ) : null}
                </CardHeader>
                <CardContent>
                  <BudgetBar spend={mtd} budget={budgetPeriod} />
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
              . CURSOR series uses{" "}
              {data.cursorSpendSource === "vendor"
                ? "the same Cursor Team Admin sync as the CURSOR tile when data exists."
                : "that mirror (enable Cursor API sync in Settings for vendor-accurate spend)."}
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
          F1 reads gateway / AzureAD / Deel; with{" "}
          <code className="font-mono">INTEGRATION_CURSOR=real</code> and a recent{" "}
          <code className="font-mono">VendorDailySpend</code> sync, the CURSOR tile and chart
          track Cursor&apos;s billed usage (filtered-usage-events), not only the gateway mirror.
        </p>
      </div>
    </>
  );
}
