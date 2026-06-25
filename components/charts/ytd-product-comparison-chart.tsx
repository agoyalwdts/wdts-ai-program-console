"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ProgramYtdProductRow } from "@/lib/f1-program-observed-spend";
import { formatUsd } from "@/lib/utils";

const PRODUCT_COLOR: Record<string, string> = {
  CURSOR: "#7c3aed",
  CHATGPT: "#10b981",
  CODEX: "#0ea5e9",
  M365_COPILOT: "#64748b",
};

const PRODUCT_DOT_CLASS: Record<string, string> = {
  CURSOR: "bg-violet-600",
  CHATGPT: "bg-emerald-500",
  CODEX: "bg-sky-500",
  M365_COPILOT: "bg-slate-500",
};

function formatAxisUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
  return `$${value.toFixed(0)}`;
}

type ChartRow = ProgramYtdProductRow & {
  varianceUsd: number;
  utilizationPct: number;
};

function toChartRows(rows: ProgramYtdProductRow[]): ChartRow[] {
  return rows
    .filter((r) => r.included)
    .map((r) => ({
      ...r,
      varianceUsd: r.actualUsd - r.plannedUsd,
      utilizationPct: r.plannedUsd > 0 ? (r.actualUsd / r.plannedUsd) * 100 : 0,
    }));
}

function YtdTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: ChartRow }[];
}) {
  if (!active || !payload?.[0]?.payload) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
      <p className="font-medium text-slate-900">{row.label}</p>
      <p className="mt-1 text-slate-600">
        Actual YTD:{" "}
        <span className="font-mono tabular-nums text-slate-900">
          {formatUsd(row.actualUsd, { decimals: 0 })}
        </span>
      </p>
      <p className="text-slate-600">
        Prorated plan:{" "}
        <span className="font-mono tabular-nums text-slate-900">
          {formatUsd(row.plannedUsd, { decimals: 0 })}
        </span>
      </p>
      <p
        className={
          row.varianceUsd > 0
            ? "mt-1 font-medium text-amber-800"
            : row.varianceUsd < 0
              ? "mt-1 font-medium text-emerald-800"
              : "mt-1 text-slate-600"
        }
      >
        Variance: {row.varianceUsd >= 0 ? "+" : ""}
        {formatUsd(row.varianceUsd, { decimals: 0 })} ({row.utilizationPct.toFixed(1)}% of plan)
      </p>
    </div>
  );
}

export function YtdProductComparisonChart({ rows }: { rows: ProgramYtdProductRow[] }) {
  const data = toChartRows(rows);
  if (data.length === 0) return null;

  const chartHeightClass = data.length <= 3 ? "h-[220px]" : "h-[280px]";

  return (
    <div className="space-y-3">
      <div className={`w-full ${chartHeightClass}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
            barCategoryGap="28%"
            barGap={4}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 11, fill: "#64748b" }}
              axisLine={{ stroke: "#cbd5e1" }}
              tickLine={false}
              tickFormatter={formatAxisUsd}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={88}
              tick={{ fontSize: 12, fill: "#334155" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<YtdTooltip />} cursor={{ fill: "#f8fafc" }} />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
              formatter={(value) => (
                <span className="text-slate-600">{value}</span>
              )}
            />
            <Bar
              dataKey="plannedUsd"
              name="Prorated plan"
              fill="#cbd5e1"
              radius={[0, 4, 4, 0]}
              maxBarSize={18}
            />
            <Bar dataKey="actualUsd" name="Actual YTD" radius={[0, 4, 4, 0]} maxBarSize={18}>
              {data.map((row) => (
                <Cell key={row.key} fill={PRODUCT_COLOR[row.key] ?? "#475569"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {data.map((row) => (
          <div
            key={row.key}
            className="flex items-start gap-2 rounded-md border border-slate-100 bg-slate-50/80 px-3 py-2"
          >
            <span
              className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${PRODUCT_DOT_CLASS[row.key] ?? "bg-slate-600"}`}
            />
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-800">{row.label}</p>
              <p className="text-[11px] text-slate-500 tabular-nums">
                {formatUsd(row.actualUsd, { decimals: 0 })} actual ·{" "}
                {formatUsd(row.plannedUsd, { decimals: 0 })} plan
              </p>
              <p
                className={
                  row.varianceUsd > 0
                    ? "text-[11px] font-medium tabular-nums text-amber-800"
                    : row.varianceUsd < 0
                      ? "text-[11px] font-medium tabular-nums text-emerald-800"
                      : "text-[11px] tabular-nums text-slate-500"
                }
              >
                {row.varianceUsd >= 0 ? "+" : ""}
                {formatUsd(row.varianceUsd, { decimals: 0 })} · {row.utilizationPct.toFixed(0)}%
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
