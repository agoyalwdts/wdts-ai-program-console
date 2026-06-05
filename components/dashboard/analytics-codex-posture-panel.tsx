"use client";

import Link from "next/link";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import type { CodexUsagePostureView, AnalyticsClipYmd } from "@/lib/analytics/codex-usage-posture";

const MODEL_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#64748b"];

function PeriodClipHint({ clip }: { clip: AnalyticsClipYmd }) {
  return (
    <p className="text-xs text-slate-600 mb-2 border-l-2 border-sky-400 pl-2">
      Filtered to Program Health window{" "}
      <span className="font-mono">{clip.start}</span> → <span className="font-mono">{clip.end}</span>.
    </p>
  );
}

export function AnalyticsCodexPosturePanel({
  view,
  clip,
  snapshotMeta,
  codexMode,
}: {
  view: CodexUsagePostureView | null;
  clip: AnalyticsClipYmd;
  snapshotMeta: { filename: string; createdAt: string; periodStart: string | null; periodEnd: string | null } | null;
  codexMode: string;
}) {
  if (codexMode !== "real") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Codex usage posture</CardTitle>
          <CardDescription>
            Set <code className="font-mono text-xs">INTEGRATION_CODEX_ENTERPRISE_ANALYTICS=real</code>{" "}
            and run the Codex sync to populate model mix and code attribution.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!view || view.bucketCount === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Codex usage posture</CardTitle>
          <CardDescription>
            No per-user usage buckets in the selected window. Wait for the hourly Codex sync or upload
            sessions JSON under{" "}
            <Link href="/settings/imports" className="underline underline-offset-2">
              Settings → Data imports
            </Link>
            .
          </CardDescription>
        </CardHeader>
        {snapshotMeta ? (
          <CardContent>
            <p className="text-xs text-slate-500">
              Latest snapshot: <span className="font-mono">{snapshotMeta.filename}</span> ·{" "}
              {snapshotMeta.createdAt.slice(0, 16).replace("T", " ")} UTC
              {snapshotMeta.periodStart && snapshotMeta.periodEnd
                ? ` · covers ${snapshotMeta.periodStart} → ${snapshotMeta.periodEnd}`
                : null}
            </p>
          </CardContent>
        ) : null}
      </Card>
    );
  }

  const pieData = view.modelCredits.slice(0, 8).map((m) => ({
    name: m.model,
    value: m.credits,
  }));
  const attributionData = view.attributionByDate.map((d) => ({
    date: d.date.slice(5),
    lines_added: d.lines_added,
    lines_removed: d.lines_removed,
  }));

  return (
    <div className="space-y-6">
      {snapshotMeta ? (
        <p className="text-xs text-slate-500">
          From <span className="font-mono">{snapshotMeta.filename}</span> · imported{" "}
          {snapshotMeta.createdAt.slice(0, 16).replace("T", " ")} UTC
          {snapshotMeta.periodStart && snapshotMeta.periodEnd ? (
            <>
              {" "}
              · snapshot window {snapshotMeta.periodStart} → {snapshotMeta.periodEnd}
            </>
          ) : null}
        </p>
      ) : null}
      <PeriodClipHint clip={clip} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Credits by model</CardTitle>
            <CardDescription>Share of Codex credits in the selected period.</CardDescription>
          </CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <p className="text-sm text-slate-500">No model breakdown in this window.</p>
            ) : (
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      label={({ name, percent }) =>
                        `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                      }
                    >
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={MODEL_COLORS[i % MODEL_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => (typeof v === "number" ? v.toFixed(2) : v)} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Code attribution</CardTitle>
            <CardDescription>Lines added and removed via Codex in the selected period.</CardDescription>
          </CardHeader>
          <CardContent>
            {attributionData.length === 0 ? (
              <p className="text-sm text-slate-500">No code attribution metrics in this window.</p>
            ) : (
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={attributionData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="lines_added" name="Lines added" fill="#10b981" stackId="a" />
                    <Bar dataKey="lines_removed" name="Lines removed" fill="#f97316" stackId="b" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Top users by model mix</CardTitle>
          <CardDescription>
            Primary model and code attribution per user. Open a row in{" "}
            <Link href="/users" className="underline underline-offset-2">
              Users
            </Link>{" "}
            for full posture.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {view.topUsers.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-slate-500">No resolved user emails in this window.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>User</TH>
                  <TH className="text-right">Credits</TH>
                  <TH>Top model</TH>
                  <TH className="text-right">Lines added</TH>
                  <TH className="text-right">Lines removed</TH>
                </TR>
              </THead>
              <TBody>
                {view.topUsers.slice(0, 25).map((u) => (
                  <TR key={u.email}>
                    <TD>
                      <Link
                        href={`/users?user=${encodeURIComponent(u.email)}#codex-usage`}
                        className="text-sky-700 hover:underline font-mono text-xs"
                      >
                        {u.email}
                      </Link>
                    </TD>
                    <TD className="text-right tabular-nums">{u.credits_used.toFixed(2)}</TD>
                    <TD className="font-mono text-xs">
                      {u.top_model ? (
                        <>
                          {u.top_model}{" "}
                          <span className="text-slate-400">({u.top_model_credits.toFixed(1)})</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </TD>
                    <TD className="text-right tabular-nums">{u.lines_added.toLocaleString()}</TD>
                    <TD className="text-right tabular-nums">{u.lines_removed.toLocaleString()}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
