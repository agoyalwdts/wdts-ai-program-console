"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

export type SpendPoint = {
  day: string;
  CURSOR: number;
  CHATGPT: number;
  CODEX: number;
  CLAUDE_AI: number;
  M365_COPILOT: number;
};

const COLOR: Record<string, string> = {
  CURSOR: "#7c3aed",
  CHATGPT: "#10b981",
  CODEX: "#0ea5e9",
  CLAUDE_AI: "#f59e0b",
  M365_COPILOT: "#64748b",
};

export function SpendTrendChart({ data }: { data: SpendPoint[] }) {
  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
          <defs>
            {Object.entries(COLOR).map(([k, c]) => (
              <linearGradient key={k} id={`g-${k}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={c} stopOpacity={0.4} />
                <stop offset="95%" stopColor={c} stopOpacity={0.05} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="#94a3b8" />
          <YAxis
            tick={{ fontSize: 11 }}
            stroke="#94a3b8"
            tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
          />
          <Tooltip
            formatter={(value) => {
              const n = typeof value === "number" ? value : Number(value);
              return Number.isFinite(n) ? `$${n.toFixed(0)}` : String(value);
            }}
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {Object.keys(COLOR).map((k) => (
            <Area
              key={k}
              type="monotone"
              dataKey={k}
              stroke={COLOR[k]}
              fill={`url(#g-${k})`}
              stackId="1"
              strokeWidth={1.5}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
