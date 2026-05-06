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
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { CURSOR_OVERVIEW_PANELS } from "@/lib/integrations/cursor/cursor-api-overview";
import type { CursorApiOverview, CursorApiSlice } from "@/lib/integrations/cursor/cursor-api-overview";

const PALETTE = ["#10b981", "#0ea5e9", "#8b5cf6", "#f59e0b", "#ec4899", "#64748b"];

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
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
