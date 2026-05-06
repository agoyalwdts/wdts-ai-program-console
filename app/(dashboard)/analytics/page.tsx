import Link from "next/link";
import { Topbar } from "@/components/dashboard/topbar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { requirePermission, requireUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { prisma } from "@/lib/prisma";
import { formatUsd } from "@/lib/utils";
import {
  CURSOR_OVERVIEW_PANELS,
  loadCursorApiOverview,
  type CursorApiSlice,
} from "@/lib/integrations/cursor/cursor-api-overview";
import { getIntegrationMode } from "@/lib/integrations/env";

export const dynamic = "force-dynamic";

const ROLLUP_DAYS = 30;

function jsonPreview(data: unknown, max = 4500): string {
  try {
    const s = JSON.stringify(data, null, 2);
    return s.length > max ? `${s.slice(0, max)}\n…` : s;
  } catch {
    return String(data);
  }
}

function SliceStatusBadge({ slice }: { slice: CursorApiSlice | undefined }) {
  if (!slice) {
    return <Badge variant="outline">Unknown</Badge>;
  }
  if (slice.status === "ok") {
    return (
      <Badge className="bg-emerald-700 hover:bg-emerald-700 text-white border-0">
        OK
      </Badge>
    );
  }
  if (slice.status === "skipped") {
    return <Badge variant="secondary">Skipped</Badge>;
  }
  return <Badge className="bg-amber-600 hover:bg-amber-600 text-white border-0">Error</Badge>;
}

function CursorSliceCard({
  title,
  apiFamily,
  path,
  slice,
}: {
  title: string;
  apiFamily: string;
  path: string;
  slice: CursorApiSlice | undefined;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription className="text-xs mt-1">
              {apiFamily}
              <span className="block font-mono text-[11px] text-slate-500 mt-0.5">
                {path}
              </span>
            </CardDescription>
          </div>
          <SliceStatusBadge slice={slice} />
        </div>
      </CardHeader>
      <CardContent className="text-xs text-slate-600 flex-1 flex flex-col gap-2">
        {slice?.status === "skipped" ? <p>{slice.reason}</p> : null}
        {slice?.status === "error" ? (
          <p className="text-amber-800 whitespace-pre-wrap break-words">{slice.message}</p>
        ) : null}
        {slice?.status === "ok" ? (
          <pre className="overflow-auto max-h-52 text-[11px] leading-snug bg-slate-50 border border-slate-200 rounded-md p-2 text-slate-800">
            {jsonPreview(slice.data)}
          </pre>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default async function AnalyticsPage() {
  await requireUser();
  await requirePermission(PERMISSIONS.DASHBOARD_VIEW_ANALYTICS);

  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - ROLLUP_DAYS);

  const [cursorOverview, vendorRollup, openAiMode, codexEaMode] = await Promise.all([
    loadCursorApiOverview(),
    prisma.vendorDailySpend.groupBy({
      by: ["vendor", "product"],
      where: { day: { gte: since } },
      _sum: { spendUsd: true, eventCount: true },
    }),
    Promise.resolve(getIntegrationMode("openai")),
    Promise.resolve(getIntegrationMode("codexenterprise")),
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
        subtitle="Vendor API snapshots and spend materialised in this dashboard"
      />
      <div className="flex-1 overflow-auto px-6 py-6 space-y-6">
        <p className="text-sm text-slate-600 max-w-3xl">
          Cursor is queried live against{" "}
          <Link
            className="text-slate-900 underline underline-offset-2"
            href="https://cursor.com/docs/api"
          >
            Cursor&apos;s documented APIs
          </Link>{" "}
          (Analytics, Admin, AI Code Tracking, Cloud Agents). Spend tiles on Program Health still
          come from{" "}
          <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">VendorDailySpend</code> syncs.
          The{" "}
          <Link
            className="text-slate-900 underline underline-offset-2"
            href="https://cursor.com/docs/sdk/typescript"
          >
            TypeScript SDK
          </Link>{" "}
          is for orchestrating agents, not a separate metrics surface — it is not wired here.
        </p>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Synced vendor spend (last {ROLLUP_DAYS} days)</CardTitle>
            <CardDescription>
              Rows from <code className="text-xs">VendorDailySpend</code> after Cursor Team Admin, OpenAI
              org costs, or Codex Enterprise Analytics jobs. OpenAI integration mode:{" "}
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
            Window{" "}
            <span className="font-mono">
              startDate={cursorOverview.window.startDate}&amp;endDate={cursorOverview.window.endDate}
            </span>{" "}
            on Analytics paths. Integration:{" "}
            <span className="font-mono">{cursorOverview.integrationMode}</span>
            {cursorOverview.apiKeyConfigured ? "" : " — no API key configured"}.
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
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {CURSOR_OVERVIEW_PANELS.map((p) => (
              <CursorSliceCard
                key={p.key}
                title={p.label}
                apiFamily={p.apiFamily}
                path={p.path}
                slice={cursorOverview.slices[p.key]}
              />
            ))}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">APIs not surfaced as separate panels</CardTitle>
            <CardDescription className="text-xs">
              Pagination beyond the first page, CSV downloads, and write paths stay out of this
              read-only page. Conversation insights require the feature enabled on the team or the
              API returns 401.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-xs text-slate-600 space-y-2">
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
                <span className="font-medium">Analytics API:</span> CSV exports; additional
                leaderboard / by-user pages beyond the first page; optional{" "}
                <code className="bg-slate-100 px-1 rounded">users=</code> filters on team endpoints.
              </li>
              <li>
                <span className="font-medium">AI Code Tracking:</span> streaming{" "}
                <code className="bg-slate-100 px-1 rounded">*.csv</code> endpoints and{" "}
                <code className="bg-slate-100 px-1 rounded">/analytics/ai-code/commits/:hash</code>{" "}
                commit detail (alpha).
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
