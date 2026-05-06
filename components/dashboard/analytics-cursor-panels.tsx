"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LineChart,
  Line,
  ComposedChart,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { CURSOR_OVERVIEW_PANELS } from "@/lib/integrations/cursor/cursor-api-overview";
import type { CursorApiOverview, CursorApiSlice } from "@/lib/integrations/cursor/cursor-api-overview";
import { formatUsd } from "@/lib/utils";

const PALETTE = ["#10b981", "#0ea5e9", "#8b5cf6", "#f59e0b", "#ec4899", "#64748b"];

/** Panels rendered in the card grid; leaderboard + AI rollup have dedicated sections above. */
const CURSOR_GRID_PANELS = CURSOR_OVERVIEW_PANELS.filter((p) => p.key !== "analyticsLeaderboard");

const SOURCE_COLORS = {
  ide: "#22c55e",
  cli: "#7dd3fc",
  cloud: "#1d4ed8",
  other: "#c4b5fd",
} as const;

type Row = Record<string, unknown>;

function isObj(v: unknown): v is Row {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function unwrapArray(data: unknown): Row[] {
  if (Array.isArray(data)) return data.filter(isObj);
  if (isObj(data) && Array.isArray(data.data)) return data.data.filter(isObj);
  return [];
}

function extractFirstArrayDeep(data: unknown, depth = 2): Row[] {
  const direct = unwrapArray(data);
  if (direct.length > 0) return direct;
  if (!isObj(data) || depth <= 0) return [];
  for (const v of Object.values(data)) {
    const nested = extractFirstArrayDeep(v, depth - 1);
    if (nested.length > 0) return nested;
  }
  return [];
}

function shortDateLabel(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd.slice(0, 10);
  const d = new Date(`${ymd}T12:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const x = Math.abs(n);
  if (x >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (x >= 10_000) return `${Math.round(n / 1000)}K`;
  if (x >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n));
}

function sumTeamMessagesFromModelsSlice(slice: CursorApiSlice | undefined): number {
  if (!slice || slice.status !== "ok") return 0;
  const rows = extractFirstArrayDeep(slice.data);
  let total = 0;
  for (const r of rows) {
    const breakdown = isObj(r.model_breakdown) ? r.model_breakdown : {};
    for (const val of Object.values(breakdown)) {
      if (isObj(val)) total += Number(val.messages ?? 0) || 0;
    }
  }
  return total;
}

type LeaderboardUserRow = {
  email: string;
  rank: number;
  tabAccepts: number;
  tabLinesAccepted: number;
  agentAccepts: number;
  agentLinesAccepted: number;
};

function parseLeaderboardMerged(slice: CursorApiSlice | undefined): {
  rows: LeaderboardUserRow[];
  totalUsersAgent: number;
} | null {
  if (!slice || slice.status !== "ok") return null;
  const root = slice.data;
  if (!isObj(root)) return null;
  const inner = root.data;
  if (!isObj(inner)) return null;
  const tabLb = inner.tab_leaderboard;
  const agentLb = inner.agent_leaderboard;
  const tabRows =
    isObj(tabLb) && Array.isArray(tabLb.data) ? (tabLb.data as Row[]).filter(isObj) : [];
  const agentRows =
    isObj(agentLb) && Array.isArray(agentLb.data) ? (agentLb.data as Row[]).filter(isObj) : [];
  const totalUsersAgent =
    isObj(agentLb) && typeof agentLb.total_users === "number" ? agentLb.total_users : 0;

  const tabByEmail = new Map<string, Row>();
  for (const t of tabRows) {
    const em = String(t.email ?? "").toLowerCase();
    if (em) tabByEmail.set(em, t);
  }

  const rows: LeaderboardUserRow[] = agentRows.map((a) => {
    const email = String(a.email ?? "");
    const tab = tabByEmail.get(email.toLowerCase());
    return {
      email,
      rank: Number(a.rank ?? 0) || 0,
      tabAccepts: Number(tab?.total_accepts ?? 0) || 0,
      tabLinesAccepted: Number(tab?.total_lines_accepted ?? 0) || 0,
      agentAccepts: Number(a.total_accepts ?? 0) || 0,
      agentLinesAccepted: Number(a.total_lines_accepted ?? 0) || 0,
    };
  });
  return { rows, totalUsersAgent };
}

function CursorAiCodeEnterpriseSection({ overview }: { overview: CursorApiOverview }) {
  const rollup = overview.aiCodeRollup;
  const lb = parseLeaderboardMerged(overview.slices.analyticsLeaderboard);
  const lbSlice = overview.slices.analyticsLeaderboard;
  const messagesApprox = sumTeamMessagesFromModelsSlice(overview.slices.analyticsModels);

  return (
    <div className="space-y-4">
      <Card className="border-violet-200 bg-violet-50/30">
        <CardHeader>
          <CardTitle className="text-lg">Cursor — AI code & usage (Enterprise)</CardTitle>
          <CardDescription>
            Built from{" "}
            <span className="font-mono text-[11px]">/analytics/ai-code/commits</span> (rolled up),
            <span className="font-mono text-[11px]"> /analytics/team/leaderboard</span>, conversation
            insights, by-user models (optional{" "}
            <span className="font-mono text-[11px]">CURSOR_ANALYTICS_USERS_FILTER</span>), plus Admin
            POST <span className="font-mono text-[11px]">/teams/daily-usage-data</span> and{" "}
            <span className="font-mono text-[11px]">/teams/spend</span> (vendor limits vs policy).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {rollup.status === "skipped" ? (
            <p className="text-sm text-slate-600">{rollup.reason}</p>
          ) : null}
          {rollup.status === "error" ? (
            <p className="text-sm text-amber-800 whitespace-pre-wrap">{rollup.message}</p>
          ) : null}

          {rollup.status === "ok" ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">
                    AI share of committed lines
                  </div>
                  <div className="text-xl font-semibold text-slate-900">
                    {rollup.rollup.totals.aiSharePct.toFixed(1)}%
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">
                    Agent (composer) lines
                  </div>
                  <div className="text-xl font-semibold text-slate-900">
                    {formatCompact(rollup.rollup.totals.composerLines)}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">
                    Tab completion lines
                  </div>
                  <div className="text-xl font-semibold text-slate-900">
                    {formatCompact(rollup.rollup.totals.tabLines)}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">
                    Model messages (team)
                  </div>
                  <div className="text-xl font-semibold text-slate-900">
                    {overview.slices.analyticsModels?.status === "ok"
                      ? formatCompact(messagesApprox)
                      : "—"}
                  </div>
                  <div className="text-[10px] text-slate-500">From model usage API</div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium text-slate-800 mb-2">
                  Lines committed by source vs AI share
                </h3>
                <div className="h-[320px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={rollup.rollup.daily}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                      <YAxis
                        yAxisId="left"
                        tick={{ fontSize: 10 }}
                        tickFormatter={(v) => formatCompact(Number(v))}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        domain={[0, 100]}
                        tick={{ fontSize: 10 }}
                        tickFormatter={(v) => `${v}%`}
                      />
                      <Tooltip
                        formatter={(value, name) => {
                          const n = typeof value === "number" ? value : Number(value);
                          if (name === "aiPct") return [`${n.toFixed(1)}%`, "AI % of lines"];
                          return [formatCompact(n), String(name)];
                        }}
                      />
                      <Legend />
                      <Bar
                        yAxisId="left"
                        dataKey="ide"
                        name="IDE"
                        stackId="src"
                        fill={SOURCE_COLORS.ide}
                      />
                      <Bar
                        yAxisId="left"
                        dataKey="cli"
                        name="CLI"
                        stackId="src"
                        fill={SOURCE_COLORS.cli}
                      />
                      <Bar
                        yAxisId="left"
                        dataKey="cloud"
                        name="Cloud agent"
                        stackId="src"
                        fill={SOURCE_COLORS.cloud}
                      />
                      <Bar
                        yAxisId="left"
                        dataKey="other"
                        name="Other"
                        stackId="src"
                        fill={SOURCE_COLORS.other}
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="aiPct"
                        name="AI % of lines"
                        stroke="#64748b"
                        strokeWidth={2}
                        dot={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium text-slate-800 mb-2">AI lines by repository</h3>
                <div className="max-h-80 overflow-auto rounded-md border border-slate-200">
                  <Table>
                    <THead>
                      <TR>
                        <TH className="pl-3">Repository</TH>
                        <TH className="text-right">AI lines</TH>
                        <TH className="text-right">Total lines</TH>
                        <TH className="text-right pr-3">AI %</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {rollup.rollup.repos.slice(0, 25).map((r) => (
                        <TR key={r.repo}>
                          <TD className="pl-3 text-xs font-mono max-w-[240px] truncate" title={r.repo}>
                            {r.repo}
                          </TD>
                          <TD className="text-right text-xs tabular-nums">
                            {r.aiLines.toLocaleString()}
                          </TD>
                          <TD className="text-right text-xs tabular-nums">
                            {r.totalLines.toLocaleString()}
                          </TD>
                          <TD className="text-right pr-3 text-xs tabular-nums">
                            {r.pct.toFixed(1)}%
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
              </div>
            </>
          ) : null}

          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="text-sm font-medium text-slate-800">Usage leaderboard</h3>
              <SliceBadge slice={lbSlice} />
            </div>
            {!lb || lb.rows.length === 0 ? (
              <p className="text-sm text-slate-600">
                {lbSlice?.status === "skipped"
                  ? lbSlice.reason
                  : lbSlice?.status === "error"
                    ? lbSlice.message
                    : "No leaderboard rows in this window."}
              </p>
            ) : (
              <>
                <p className="text-xs text-slate-500 mb-2">
                  Top {lb.rows.length}
                  {lb.totalUsersAgent > 0 ? ` of ${lb.totalUsersAgent} members` : ""} (agent ranking)
                </p>
                <div className="max-h-96 overflow-auto rounded-md border border-slate-200">
                  <Table>
                    <THead>
                      <TR>
                        <TH className="pl-3 w-12">#</TH>
                        <TH>User</TH>
                        <TH className="text-right">Accepted diffs</TH>
                        <TH className="text-right">Tab completions</TH>
                        <TH className="text-right">Agent lines</TH>
                        <TH className="text-right pr-3">Tab lines</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {lb.rows.map((r) => (
                        <TR key={r.email}>
                          <TD className="pl-3 text-xs tabular-nums">{r.rank}</TD>
                          <TD className="text-xs font-mono truncate max-w-[200px]" title={r.email}>
                            {r.email}
                          </TD>
                          <TD className="text-right text-xs tabular-nums">
                            {r.agentAccepts.toLocaleString()}
                          </TD>
                          <TD className="text-right text-xs tabular-nums">
                            {r.tabAccepts.toLocaleString()}
                          </TD>
                          <TD className="text-right text-xs tabular-nums">
                            {r.agentLinesAccepted.toLocaleString()}
                          </TD>
                          <TD className="text-right pr-3 text-xs tabular-nums">
                            {r.tabLinesAccepted.toLocaleString()}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SliceBadge({ slice }: { slice: CursorApiSlice | undefined }) {
  if (!slice) return <Badge variant="outline">Unknown</Badge>;
  if (slice.status === "ok") {
    return <Badge className="bg-emerald-700 hover:bg-emerald-700 text-white border-0">OK</Badge>;
  }
  if (slice.status === "skipped") return <Badge variant="secondary">Skipped</Badge>;
  return <Badge className="bg-amber-600 hover:bg-amber-600 text-white border-0">Error</Badge>;
}

function GenericTable({ rows }: { rows: Row[] }) {
  if (rows.length === 0) return <p className="text-sm text-slate-500">No rows in response.</p>;
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].slice(0, 8);
  return (
    <div className="max-h-72 overflow-auto">
      <Table>
        <THead>
          <TR>
            {keys.map((k) => (
              <TH key={k}>{k}</TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {rows.slice(0, 40).map((r, i) => (
            <TR key={i}>
              {keys.map((k) => (
                <TD key={k} className="text-xs max-w-[14rem] truncate" title={String(r[k] ?? "")}>
                  {String(r[k] ?? "—")}
                </TD>
              ))}
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

function PanelBody({ panelKey, slice }: { panelKey: string; slice: CursorApiSlice | undefined }) {
  if (!slice || slice.status !== "ok") {
    return (
      <div className="text-sm text-slate-600">
        {slice?.status === "skipped" ? <p>{slice.reason}</p> : null}
        {slice?.status === "error" ? <p className="text-amber-800 whitespace-pre-wrap">{slice.message}</p> : null}
        {!slice ? <p>No data.</p> : null}
      </div>
    );
  }

  const rows = extractFirstArrayDeep(slice.data);

  if (panelKey === "analyticsDau") {
    const data = rows
      .map((r) => ({
        day: shortDateLabel(String(r.date ?? r.event_date ?? "")),
        dau: Number(r.dau ?? 0) || 0,
        cli: Number(r.cli_dau ?? 0) || 0,
        bugbot: Number(r.bugbot_dau ?? 0) || 0,
      }))
      .filter((r) => r.day.length > 0);
    if (data.length === 0) return <GenericTable rows={rows} />;
    return (
      <div className="h-[230px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="day" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="dau" name="DAU" stroke={PALETTE[0]} dot={false} />
            <Line type="monotone" dataKey="cli" name="CLI DAU" stroke={PALETTE[1]} dot={false} />
            <Line type="monotone" dataKey="bugbot" name="Bugbot DAU" stroke={PALETTE[3]} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (panelKey === "analyticsModels") {
    const byDay = rows
      .map((r) => {
        const date = String(r.date ?? "");
        const breakdown = isObj(r.model_breakdown) ? r.model_breakdown : {};
        return { date, breakdown };
      })
      .filter((r) => r.date.length > 0);
    if (byDay.length === 0) return <GenericTable rows={rows} />;
    const modelTotals = new Map<string, number>();
    for (const day of byDay) {
      for (const [m, val] of Object.entries(day.breakdown)) {
        if (isObj(val)) modelTotals.set(m, (modelTotals.get(m) ?? 0) + (Number(val.messages ?? 0) || 0));
      }
    }
    const topModels = [...modelTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([m]) => m);
    const data = byDay.map((d) => {
      const out: Record<string, string | number> = { day: shortDateLabel(d.date) };
      for (const m of topModels) {
        const mv = isObj(d.breakdown[m]) ? d.breakdown[m] : {};
        out[m] = Number(mv.messages ?? 0) || 0;
      }
      return out;
    });
    return (
      <div className="h-[250px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="day" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Legend />
            {topModels.map((m, i) => (
              <Bar key={m} dataKey={m} stackId="models" fill={PALETTE[i % PALETTE.length]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (panelKey === "analyticsTabs" || panelKey === "analyticsAgentEdits") {
    const data = rows
      .map((r) => ({
        day: shortDateLabel(String(r.event_date ?? "")),
        suggestions: Number(r.total_suggestions ?? r.total_suggested_diffs ?? 0) || 0,
        accepts: Number(r.total_accepts ?? r.total_accepted_diffs ?? 0) || 0,
      }))
      .filter((r) => r.day.length > 0);
    if (data.length === 0) return <GenericTable rows={rows} />;
    return (
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="day" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Legend />
            <Bar dataKey="suggestions" fill={PALETTE[1]} />
            <Bar dataKey="accepts" fill={PALETTE[0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (panelKey === "analyticsConversationInsights") {
    const root = slice.data;
    if (!isObj(root) || !isObj(root.data)) return <GenericTable rows={rows} />;
    const intentsBlock = isObj(root.data.intents) ? root.data.intents : {};
    const dist = Array.isArray(intentsBlock.distribution)
      ? (intentsBlock.distribution as Row[])
      : [];
    const chartData = dist
      .map((x) => ({
        name: String(x.intent ?? x.label ?? "").slice(0, 28),
        count: Number(x.count ?? 0) || 0,
      }))
      .filter((x) => x.name.length > 0);
    if (chartData.length === 0) return <GenericTable rows={rows} />;
    return (
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} angle={-25} height={70} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Bar dataKey="count" name="Conversations" fill={PALETTE[2]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (panelKey === "analyticsByUserModels") {
    const root = slice.data;
    if (!isObj(root) || !isObj(root.data)) return <GenericTable rows={rows} />;
    const dataObj = root.data as Record<string, unknown>;
    const emails = Object.keys(dataObj).filter((k) => Array.isArray(dataObj[k]));
    const tableRows = emails.slice(0, 25).map((email) => {
      const arr = dataObj[email] as Row[];
      return { email, periods: arr.length };
    });
    if (tableRows.length === 0) return <GenericTable rows={rows} />;
    return (
      <div className="max-h-64 overflow-auto rounded-md border border-slate-200">
        <Table>
          <THead>
            <TR>
              <TH className="pl-2">User</TH>
              <TH className="pr-2 text-right">Metric rows</TH>
            </TR>
          </THead>
          <TBody>
            {tableRows.map((r) => (
              <TR key={r.email}>
                <TD className="pl-2 text-xs font-mono truncate max-w-[220px]" title={r.email}>
                  {r.email}
                </TD>
                <TD className="pr-2 text-right text-xs tabular-nums">{r.periods}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    );
  }

  if (panelKey === "analyticsTopExtensions") {
    const data = rows
      .map((r) => ({
        name: `.${String(r.file_extension ?? "").trim()}`,
        files: Number(r.total_files ?? 0) || 0,
      }))
      .filter((r) => r.name !== ".");
    if (data.length === 0) return <GenericTable rows={rows} />;
    const top = [...data].sort((a, b) => b.files - a.files).slice(0, 10);
    return (
      <div className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={top} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis type="number" tick={{ fontSize: 10 }} />
            <YAxis dataKey="name" type="category" width={90} tick={{ fontSize: 10 }} />
            <Tooltip />
            <Bar dataKey="files" fill={PALETTE[0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return <GenericTable rows={rows} />;
}

function CursorAdminApiSection({ overview }: { overview: CursorApiOverview }) {
  const daily = overview.slices.adminDailyUsage;
  const spend = overview.slices.adminTeamSpend;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="border-slate-200">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">Daily usage (Admin API)</CardTitle>
              <CardDescription className="text-xs mt-1">
                POST <span className="font-mono">/teams/daily-usage-data</span> — hourly aggregates;
                Cursor recommends polling ≤ once per hour. Range clamped to 30 days.
              </CardDescription>
            </div>
            <SliceBadge slice={daily} />
          </div>
        </CardHeader>
        <CardContent className="text-xs text-slate-600">
          {!daily || daily.status !== "ok" ? (
            <PanelBody panelKey="__adminDaily" slice={daily} />
          ) : isObj(daily.data) && Array.isArray((daily.data as { data?: unknown }).data) ? (
            <p>
              <span className="font-semibold text-slate-900">
                {(daily.data as { data: unknown[] }).data.length}
              </span>{" "}
              day-user metric rows in this window.
            </p>
          ) : (
            <p className="text-slate-500">Unexpected response shape.</p>
          )}
        </CardContent>
      </Card>
      <Card className="border-slate-200">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">Team spend &amp; limits (Admin API)</CardTitle>
              <CardDescription className="text-xs mt-1">
                POST <span className="font-mono">/teams/spend</span> —{" "}
                <span className="font-mono">monthlyLimitDollars</span> /{" "}
                <span className="font-mono">hardLimitOverrideDollars</span> vs WDTS policy caps
                (read-only). Writes use{" "}
                <span className="font-mono">/teams/user-spend-limit</span> (not called here).
              </CardDescription>
            </div>
            <SliceBadge slice={spend} />
          </div>
        </CardHeader>
        <CardContent className="text-xs text-slate-600">
          {!spend || spend.status !== "ok" ? (
            <PanelBody panelKey="__adminSpend" slice={spend} />
          ) : isObj(spend.data) && Array.isArray((spend.data as { teamMemberSpend?: unknown }).teamMemberSpend) ? (
            <div className="max-h-64 overflow-auto rounded-md border border-slate-200">
              <Table>
                <THead>
                  <TR>
                    <TH className="pl-2">Email</TH>
                    <TH className="text-right">Monthly limit ($)</TH>
                    <TH className="text-right pr-2">Cycle spend</TH>
                  </TR>
                </THead>
                <TBody>
                  {((spend.data as { teamMemberSpend: Row[] }).teamMemberSpend ?? [])
                    .slice(0, 30)
                    .map((m, i) => (
                      <TR key={String(m.email ?? i)}>
                        <TD className="pl-2 font-mono truncate max-w-[200px]" title={String(m.email ?? "")}>
                          {String(m.email ?? "—")}
                        </TD>
                        <TD className="text-right tabular-nums">
                          {m.monthlyLimitDollars == null ? "—" : String(m.monthlyLimitDollars)}
                        </TD>
                        <TD className="text-right pr-2 tabular-nums">
                          {formatUsd((Number(m.overallSpendCents ?? 0) || 0) / 100, { decimals: 2 })}
                        </TD>
                      </TR>
                    ))}
                </TBody>
              </Table>
            </div>
          ) : (
            <p className="text-slate-500">Unexpected response shape.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function AnalyticsCursorPanels({ overview }: { overview: CursorApiOverview }) {
  return (
    <div className="space-y-4">
      <CursorAiCodeEnterpriseSection overview={overview} />
      <CursorAdminApiSection overview={overview} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {CURSOR_GRID_PANELS.map((p) => {
        const slice = overview.slices[p.key];
        return (
          <Card key={p.key} className="flex flex-col">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{p.label}</CardTitle>
                  <CardDescription className="text-xs mt-1">
                    {p.apiFamily}
                    <span className="block font-mono text-[11px] text-slate-500 mt-0.5">{p.path}</span>
                  </CardDescription>
                </div>
                <SliceBadge slice={slice} />
              </div>
            </CardHeader>
            <CardContent className="text-xs text-slate-600 flex-1 flex flex-col gap-2">
              <PanelBody panelKey={p.key} slice={slice} />
            </CardContent>
          </Card>
        );
      })}
      </div>
    </div>
  );
}
