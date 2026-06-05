import Link from "next/link";
import { Suspense } from "react";
import { Topbar } from "@/components/dashboard/topbar";
import { F1PeriodRangeLine } from "@/components/dashboard/f1-period-range-line";
import { HealthPeriodSelector } from "@/components/dashboard/health-period-selector";
import { AnalyticsCursorPanels } from "@/components/dashboard/analytics-cursor-panels";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { requirePermission, requireUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { prisma } from "@/lib/prisma";
import { formatUsd } from "@/lib/utils";
import { loadCursorApiOverview } from "@/lib/integrations/cursor/cursor-api-overview";
import { getIntegrationMode } from "@/lib/integrations/env";
import { loadLatestProgramVendorExportSnapshots } from "@/lib/analytics/manual-vendor-snapshots";
import { AnalyticsManualVendorCharts } from "@/components/dashboard/analytics-manual-vendor-charts";
import { analyticsWindowForF1Plan } from "@/lib/cursor-analytics-window";
import {
  formatLocalYmd,
  resolveF1PlanFromSearchParams,
  type F1SearchParams,
} from "@/lib/f1-period";

export const dynamic = "force-dynamic";

function analyticsPeriodQueryString(sp: F1SearchParams): string {
  const q = new URLSearchParams();
  const period = Array.isArray(sp.period) ? sp.period[0] : sp.period;
  const from = Array.isArray(sp.from) ? sp.from[0] : sp.from;
  const to = Array.isArray(sp.to) ? sp.to[0] : sp.to;
  if (period) q.set("period", period);
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export default async function AnalyticsPage(props: { searchParams: Promise<F1SearchParams> }) {
  await requireUser();
  await requirePermission(PERMISSIONS.DASHBOARD_VIEW_ANALYTICS);

  const sp = await props.searchParams;
  const periodQs = analyticsPeriodQueryString(sp);
  const now = new Date();
  const { plan, period } = resolveF1PlanFromSearchParams(now, sp);
  const analyticsWindow = analyticsWindowForF1Plan(plan);
  const dayStart = new Date(
    plan.periodStart.getFullYear(),
    plan.periodStart.getMonth(),
    plan.periodStart.getDate(),
  );
  const dayEnd = new Date(
    plan.periodEnd.getFullYear(),
    plan.periodEnd.getMonth(),
    plan.periodEnd.getDate(),
  );

  const [cursorOverview, vendorRollup, openAiMode, codexEaMode, manualVendorSnapshots] =
    await Promise.all([
      loadCursorApiOverview({ analyticsWindow }),
      prisma.vendorDailySpend.groupBy({
        by: ["vendor", "product"],
        where: { day: { gte: dayStart, lte: dayEnd } },
        _sum: { spendUsd: true, eventCount: true },
      }),
      Promise.resolve(getIntegrationMode("openai")),
      Promise.resolve(getIntegrationMode("codexenterprise")),
      loadLatestProgramVendorExportSnapshots(prisma),
    ]);

  const sortedRollup = [...vendorRollup].sort((a, b) => {
    const v = a.vendor.localeCompare(b.vendor);
    if (v !== 0) return v;
    return a.product.localeCompare(b.product);
  });

  return (
    <div className="flex flex-col min-h-0">
      <Topbar
        title="Analytics"
        subtitle="Decision-focused analytics with optional diagnostics"
      />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-6 py-2.5">
        <div className="flex items-center gap-3">
          <F1PeriodRangeLine plan={plan} period={period} />
          <Link
            className="inline-flex items-center rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
            href={`/analytics/codex${periodQs}`}
          >
            Codex posture
          </Link>
          <Link
            className="inline-flex items-center rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
            href={`/analytics/diagnostics${periodQs}`}
          >
            Diagnostics
          </Link>
        </div>
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
      <div className="flex-1 overflow-auto px-6 py-6 space-y-6">
        <p className="text-sm text-slate-600 max-w-3xl">
          Cursor is queried live against{" "}
          <Link
            className="text-slate-900 underline underline-offset-2"
            href="https://cursor.com/docs/api"
          >
            Cursor&apos;s documented APIs
          </Link>{" "}
          (Analytics, Admin, AI Code Tracking, Cloud Agents). The selected period matches Program
          Health: charts use{" "}
          <span className="font-mono text-xs">
            startDate={analyticsWindow.startDate}&amp;endDate={analyticsWindow.endDate}
          </span>{" "}
          on Analytics paths. Integration:{" "}
          <span className="font-mono">{cursorOverview.integrationMode}</span>
          {cursorOverview.apiKeyConfigured ? "" : " — no API key configured"}. The{" "}
          <Link
            className="text-slate-900 underline underline-offset-2"
            href="https://cursor.com/docs/sdk/typescript"
          >
            TypeScript SDK
          </Link>{" "}
          is for orchestrating agents, not a separate metrics surface — it is not wired here.
          Drill down into lower-priority endpoint probes on the{" "}
          <Link
            className="text-slate-900 underline underline-offset-2"
            href={`/analytics/diagnostics${periodQs}`}
          >
            Diagnostics page
          </Link>
          .
        </p>

        <AnalyticsManualVendorCharts
          snapshots={manualVendorSnapshots}
          clipRangeYmd={{
            start: formatLocalYmd(plan.periodStart),
            end: formatLocalYmd(plan.periodEnd),
          }}
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Synced vendor spend</CardTitle>
            <CardDescription>
              Rows from <code className="text-xs">VendorDailySpend</code> in{" "}
              <span className="font-medium text-slate-800">{plan.rangeDescription}</span> after Cursor
              Team Admin, OpenAI org costs, or Codex Enterprise Analytics jobs. OpenAI integration mode:{" "}
              <span className="font-mono">{openAiMode}</span>; Codex Enterprise Analytics mode:{" "}
              <span className="font-mono">{codexEaMode}</span>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sortedRollup.length === 0 ? (
              <p className="text-sm text-slate-500">No vendor rows in this window yet.</p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Vendor key</TH>
                    <TH>Product</TH>
                    <TH className="text-right">Spend</TH>
                    <TH className="text-right">Events</TH>
                  </TR>
                </THead>
                <TBody>
                  {sortedRollup.map((r) => (
                    <TR key={`${r.vendor}|${r.product}`}>
                      <TD className="font-mono text-xs">{r.vendor}</TD>
                      <TD>{r.product}</TD>
                      <TD className="text-right tabular-nums">
                        {formatUsd(r._sum.spendUsd ?? 0)}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {r._sum.eventCount ?? 0}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div>
          <h2 className="text-sm font-semibold text-slate-900 mb-2">Cursor API panels</h2>
          <p className="text-xs text-slate-500 mb-3 max-w-3xl">
            Enterprise-only endpoints may return 403 if the key or plan does not include them (for
            example{" "}
            <Link
              className="underline underline-offset-2"
              href="https://cursor.com/docs/account/teams/ai-code-tracking-api"
            >
              AI Code Tracking
            </Link>
            ).
          </p>
          <AnalyticsCursorPanels overview={cursorOverview} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">APIs not surfaced as separate panels</CardTitle>
            <CardDescription className="text-xs">
              These are documented on the same host. Most are intentionally omitted from default
              analytics because they are exploratory or operator-debug surfaces rather than routine
              decision metrics. Use the diagnostics drill-down for endpoint-level detail.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-xs text-slate-600 space-y-2">
            <p>
              <Link
                className="text-slate-900 underline underline-offset-2 font-medium"
                href={`/analytics/diagnostics${periodQs}`}
              >
                Open Analytics diagnostics
              </Link>
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <span className="font-medium">Admin API:</span> POST{" "}
                <code className="bg-slate-100 px-1 rounded">/teams/filtered-usage-events</code>{" "}
                (used by vendor spend sync, not duplicated here), POST{" "}
                <code className="bg-slate-100 px-1 rounded">/teams/spend</code>, POST{" "}
                <code className="bg-slate-100 px-1 rounded">/teams/daily-usage-data</code>, audit
                logs pagination, groups, spend limits, member removal, …
              </li>
              <li>
                <span className="font-medium">Analytics API:</span> conversation insights,
                leaderboard, Bugbot, plans/skills/commands (beyond the seven team metrics above), and
                all <code className="bg-slate-100 px-1 rounded">/analytics/by-user/…</code> routes.
              </li>
              <li>
                <span className="font-medium">AI Code Tracking:</span>{" "}
                <code className="bg-slate-100 px-1 rounded">/analytics/ai-code/changes</code>, CSV
                exports, commit detail hashes.
              </li>
              <li>
                <span className="font-medium">Cloud Agents:</span> create runs, streams, artifacts,
                archive/delete — operator actions rather than analytics.
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
