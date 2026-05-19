import Link from "next/link";
import { Suspense } from "react";
import { Topbar } from "@/components/dashboard/topbar";
import { F1PeriodRangeLine } from "@/components/dashboard/f1-period-range-line";
import { HealthPeriodSelector } from "@/components/dashboard/health-period-selector";
import { AnalyticsCursorPanels } from "@/components/dashboard/analytics-cursor-panels";
import { AnalyticsManualVendorCharts } from "@/components/dashboard/analytics-manual-vendor-charts";
import { requirePermission, requireUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { prisma } from "@/lib/prisma";
import { loadCursorApiOverview } from "@/lib/integrations/cursor/cursor-api-overview";
import { loadLatestProgramVendorExportSnapshots } from "@/lib/analytics/manual-vendor-snapshots";
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

export default async function AnalyticsDiagnosticsPage(props: { searchParams: Promise<F1SearchParams> }) {
  await requireUser();
  await requirePermission(PERMISSIONS.DASHBOARD_VIEW_ANALYTICS);

  const sp = await props.searchParams;
  const periodQs = analyticsPeriodQueryString(sp);
  const now = new Date();
  const { plan, period } = resolveF1PlanFromSearchParams(now, sp);
  const analyticsWindow = analyticsWindowForF1Plan(plan);

  const [cursorOverview, manualVendorSnapshots] = await Promise.all([
    loadCursorApiOverview({ analyticsWindow, includeDiagnostics: true }),
    loadLatestProgramVendorExportSnapshots(prisma),
  ]);

  return (
    <div className="flex flex-col min-h-0">
      <Topbar
        title="Analytics Diagnostics"
        subtitle="Endpoint-level probes and imported snapshot previews"
      />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-6 py-2.5">
        <div className="flex items-center gap-3">
          <F1PeriodRangeLine plan={plan} period={period} />
          <Link
            className="inline-flex items-center rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
            href={`/analytics${periodQs}`}
          >
            Analytics
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
          This page is for drill-down troubleshooting. It includes lower-priority Cursor API probes
          and raw imported snapshot previews that are intentionally excluded from the main Analytics
          tab.
        </p>

        <AnalyticsCursorPanels
          overview={cursorOverview}
          includeCorePanels={false}
          includeDiagnosticPanels
        />

        <AnalyticsManualVendorCharts
          snapshots={manualVendorSnapshots}
          clipRangeYmd={{
            start: formatLocalYmd(plan.periodStart),
            end: formatLocalYmd(plan.periodEnd),
          }}
          includeCoreSections={false}
          includeDiagnosticSections
        />
      </div>
    </div>
  );
}
