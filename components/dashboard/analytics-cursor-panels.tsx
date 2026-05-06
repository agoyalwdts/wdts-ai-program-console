"use client";

import { useMemo } from "react";
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
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import type { CursorApiOverview, CursorApiSlice } from "@/lib/integrations/cursor/cursor-api-overview";
import { CURSOR_OVERVIEW_PANELS } from "@/lib/integrations/cursor/cursor-api-overview";
import {
  parseDauRows,
  parseModelDayRows,
  parseAgentEditsRows,
  parseTabsRows,
  parseClientVersionRows,
  parseExtensionRows,
  objectToKeyValueRows,
  extractFirstArrayDeep,
} from "@/lib/cursor-analytics-parse";

const PALETTE = [
  "#10b981",
  "#0ea5e9",
  "#8b5cf6",
  "#f59e0b",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#64748b",
  "#a855f7",
  "#22c55e",
];

function shortDateLabel(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd.slice(0, 10);
  const d = new Date(`${ymd}T12:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function SliceBadge({ slice }: { slice: CursorApiSlice | undefined }) {
  if (!slice) return <Badge variant="outline">Unknown</Badge>;
  if (slice.status === "ok")
    return <Badge className="bg-emerald-700 hover:bg-emerald-700 text-white border-0">OK</Badge>;
  if (slice.status === "skipped") return <Badge variant="secondary">Skipped</Badge>;
  return <Badge className="bg-amber-600 hover:bg-amber-600 text-white border-0">Error</Badge>;
}

function RawDetails({ data }: { data: unknown }) {
  let text = "";
  try {
    text = JSON.stringify(data, null, 2);
  } catch {
    text = String(data);
  }
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-slate-500 hover:text-slate-700">View raw JSON</summary>
      <pre className="mt-2 max-h-40 overflow-auto rounded border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-800">
        {text.slice(0, 12000)}
        {text.length > 12000 ? "\n…" : ""}
      </pre>
    </details>
  );
}

function JsonArrayTable({ rows, maxCols = 10 }: { rows: Record<string, unknown>[]; maxCols?: number }) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">No tabular rows in this response.</p>;
  }
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].slice(0, maxCols);
  return (
    <div className="overflow-auto max-h-64">
      <Table>
        <THead>
          <TR>
            {keys.map((k) => (
              <TH key={k} className="font-mono text-[11px]">
                {k}
              </TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {rows.slice(0, 50).map((r, i) => (
            <TR key={i}>
              {keys.map((k) => (
                <TD key={k} className="text-[11px] max-w-[14rem] truncate" title={String(r[k])}>
                  {formatCell(r[k])}
                </TD>
              ))}
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "object") return JSON.stringify(v).slice(0, 120);
  return String(v);
}

function ModelStackChart({ rows }: { rows: ReturnType<typeof parseModelDayRows> }) {
  const { data, keys } = useMemo(() => {
    const totals = new Map<string, number>();
    for (const d of rows) {
      for (const [m, v] of Object.entries(d.breakdown)) {
        totals.set(m, (totals.get(m) ?? 0) + v.messages);
      }
    }
    const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k);
    const chartRows = rows.map((d) => {
      const o: Record<string, string | number> = { label: shortDateLabel(d.date) };
      let other = 0;
      for (const [m, v] of Object.entries(d.breakdown)) {
        if (top.includes(m)) o[m] = v.messages;
        else other += v.messages;
      }
      o.Other = other;
      return o;
    });
    const anyOther = chartRows.some((row) => Number(row.Other) > 0);
    const keysOut = anyOther ? [...top, "Other"] : top;
    return { data: chartRows, keys: keysOut };
  }, [rows]);

  if (data.length === 0) return <p className="text-sm text-slate-500">No model breakdown.</p>;

  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#94a3b8" />
          <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          {keys.map((k, i) => (
            <Bar key={k} dataKey={k} stackId="m" fill={PALETTE[i % PALETTE.length]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ClientVersionStack({ rows }: { rows: ReturnType<typeof parseClientVersionRows> }) {
  const { data, versions } = useMemo(() => {
    const byDay = new Map<string, Map<string, number>>();
    for (const r of rows) {
      if (!byDay.has(r.event_date)) byDay.set(r.event_date, new Map());
      byDay.get(r.event_date)!.set(r.client_version, r.percentage);
    }
    const versionsSorted = [...new Set(rows.map((r) => r.client_version))].sort();
    const chartData = [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, m]) => {
        const o: Record<string, string | number> = { label: shortDateLabel(date) };
        for (const v of versionsSorted) {
          o[v] = m.get(v) ?? 0;
        }
        return o;
      });
    return { data: chartData, versions: versionsSorted };
  }, [rows]);

  if (data.length === 0) return <p className="text-sm text-slate-500">No version rows.</p>;

  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#94a3b8" />
          <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} formatter={(v) => [`${Number(v).toFixed(1)}%`, ""]} />
          <Legend wrapperStyle={{ fontSize: 9 }} />
          {versions.map((v, i) => (
            <Bar key={v} dataKey={v} stackId="v" fill={PALETTE[i % PALETTE.length]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
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

  const data = slice.data;

  switch (panelKey) {
    case "analyticsDau": {
      const rows = parseDauRows(data);
      if (rows.length === 0) return <EmptyVisual />;
      const chartData = rows.map((r) => ({
        label: shortDateLabel(r.date),
        DAU: r.dau,
        CLI: r.cli_dau,
        "Cloud agent": r.cloud_agent_dau,
        Bugbot: r.bugbot_dau,
      }));
      return (
        <div className="h-[240px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="DAU" stroke={PALETTE[0]} dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="CLI" stroke={PALETTE[1]} dot={false} strokeWidth={1.5} />
              <Line type="monotone" dataKey="Cloud agent" stroke={PALETTE[2]} dot={false} strokeWidth={1.5} />
              <Line type="monotone" dataKey="Bugbot" stroke={PALETTE[3]} dot={false} strokeWidth={1.5} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      );
    }
    case "analyticsModels": {
      const rows = parseModelDayRows(data);
      if (rows.length === 0) return <EmptyVisual />;
      const totals = new Map<string, number>();
      for (const d of rows) {
        for (const [m, v] of Object.entries(d.breakdown)) {
          totals.set(m, (totals.get(m) ?? 0) + v.messages);
        }
      }
      const topModels = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
      return (
        <div className="space-y-4">
          <ModelStackChart rows={rows} />
          <div className="overflow-auto max-h-48">
            <Table>
              <THead>
                <TR>
                  <TH>Model</TH>
                  <TH className="text-right">Messages (window)</TH>
                </TR>
              </THead>
              <TBody>
                {topModels.map(([m, c]) => (
                  <TR key={m}>
                    <TD className="font-mono text-[11px] max-w-[16rem] truncate" title={m}>
                      {m}
                    </TD>
                    <TD className="text-right tabular-nums text-sm">{c.toLocaleString()}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </div>
      );
    }
    case "analyticsAgentEdits": {
      const rows = parseAgentEditsRows(data);
      if (rows.length === 0) return <EmptyVisual />;
      const chartData = rows.map((r) => ({
        label: shortDateLabel(r.event_date),
        "Green lines accepted": r.total_green_lines_accepted,
        "Red lines accepted": r.total_red_lines_accepted,
        "Lines suggested": r.total_lines_suggested,
      }));
      return (
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="Green lines accepted" stroke={PALETTE[0]} dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="Red lines accepted" stroke={PALETTE[1]} dot={false} strokeWidth={2} />
              <Line
                type="monotone"
                dataKey="Lines suggested"
                stroke={PALETTE[4]}
                dot={false}
                strokeWidth={1.5}
                strokeDasharray="4 4"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      );
    }
    case "analyticsTabs": {
      const rows = parseTabsRows(data);
      if (rows.length === 0) return <EmptyVisual />;
      const chartData = rows.map((r) => ({
        label: shortDateLabel(r.event_date),
        Accepts: r.total_accepts,
        Suggestions: r.total_suggestions,
        "Lines accepted": r.total_lines_accepted,
      }));
      return (
        <div className="h-[240px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="Suggestions" fill={PALETTE[1]} />
              <Bar dataKey="Accepts" fill={PALETTE[0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      );
    }
    case "analyticsClientVersions": {
      const rows = parseClientVersionRows(data);
      if (rows.length === 0) return <EmptyVisual />;
      return <ClientVersionStack rows={rows} />;
    }
    case "analyticsTopExtensions": {
      const rows = parseExtensionRows(data);
      if (rows.length === 0) return <EmptyVisual />;
      const agg = new Map<string, number>();
      for (const r of rows) {
        agg.set(r.file_extension, (agg.get(r.file_extension) ?? 0) + r.total_files);
      }
      const top = [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
      const chartData = top.map(([name, value]) => ({ name: `.${name}`, value }));
      return (
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" tick={{ fontSize: 10 }} stroke="#94a3b8" />
              <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 10 }} stroke="#94a3b8" />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
              <Bar dataKey="value" fill={PALETTE[0]} name="Files" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      );
    }
    case "analyticsMcp": {
      const arr = extractFirstArrayDeep(data);
      const asObjects = arr.filter((x): x is Record<string, unknown> => x != null && typeof x === "object" && !Array.isArray(x));
      if (asObjects.length > 0) return <JsonArrayTable rows={asObjects} />;
      const kv = objectToKeyValueRows(data);
      if (kv.length === 0) return <EmptyVisual />;
      return (
        <Table>
          <THead>
            <TR>
              <TH>Key</TH>
              <TH>Value</TH>
            </TR>
          </THead>
          <TBody>
            {kv.map((r) => (
              <TR key={r.key}>
                <TD className="font-mono text-xs">{r.key}</TD>
                <TD className="text-xs break-all">{r.value}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      );
    }
    case "adminMembers":
    case "cloudAgents":
    case "aiCodeCommits": {
      const arr = extractFirstArrayDeep(data);
      const asObjects = arr.filter((x): x is Record<string, unknown> => x != null && typeof x === "object" && !Array.isArray(x));
      if (asObjects.length > 0) return <JsonArrayTable rows={asObjects} />;
      const kv = objectToKeyValueRows(data);
      if (kv.length > 0) {
        return (
          <Table>
            <THead>
              <TR>
                <TH>Key</TH>
                <TH>Value</TH>
              </TR>
            </THead>
            <TBody>
              {kv.slice(0, 40).map((r) => (
                <TR key={r.key}>
                  <TD className="font-mono text-xs">{r.key}</TD>
                  <TD className="text-xs break-all max-w-md truncate" title={r.value}>
                    {r.value}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        );
      }
      return <EmptyVisual />;
    }
    case "cloudMe": {
      const kv = objectToKeyValueRows(data);
      if (kv.length === 0) return <EmptyVisual />;
      return (
        <Table>
          <THead>
            <TR>
              <TH>Field</TH>
              <TH>Value</TH>
            </TR>
          </THead>
          <TBody>
            {kv.map((r) => (
              <TR key={r.key}>
                <TD className="font-mono text-xs">{r.key}</TD>
                <TD className="text-xs break-all">{r.value}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      );
    }
    default: {
      const arr = extractFirstArrayDeep(data);
      const objs = arr.filter(
        (x): x is Record<string, unknown> => x != null && typeof x === "object" && !Array.isArray(x),
      );
      if (objs.length > 0) return <JsonArrayTable rows={objs} />;
      return <EmptyVisual />;
    }
  }
}

function EmptyVisual() {
  return <p className="text-sm text-slate-500">No series parsed from this response.</p>;
}

export function AnalyticsCursorPanels({ overview }: { overview: CursorApiOverview }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {CURSOR_OVERVIEW_PANELS.map((p) => {
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
              {slice?.status === "ok" ? <RawDetails data={slice.data} /> : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
