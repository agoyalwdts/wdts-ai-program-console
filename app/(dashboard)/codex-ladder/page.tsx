import { Topbar } from "@/components/dashboard/topbar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CODEX_TIERS } from "@/lib/program";
import { cn, formatUsd } from "@/lib/utils";
import { getOpenAIClient } from "@/lib/integrations";
import type { CodexSeat, CodexSubTier } from "@/lib/integrations/openai";

export const dynamic = "force-dynamic";

type Tier = CodexSubTier;
const TIER_ORDER: Tier[] = ["POWER", "STANDARD", "LIGHT", "DISCOVERY"];

const TIER_STYLES: Record<Tier, { bg: string; text: string; bar: string; pill: "violet" | "blue" | "slate" | "outline" }> = {
  POWER: { bg: "bg-violet-50", text: "text-violet-900", bar: "bg-violet-500", pill: "violet" },
  STANDARD: { bg: "bg-sky-50", text: "text-sky-900", bar: "bg-sky-500", pill: "blue" },
  LIGHT: { bg: "bg-slate-100", text: "text-slate-900", bar: "bg-slate-500", pill: "slate" },
  DISCOVERY: { bg: "bg-emerald-50", text: "text-emerald-900", bar: "bg-emerald-500", pill: "outline" },
};

const TIER_QUOTAS: Record<Tier, number> = {
  POWER: 16,
  STANDARD: 40,
  LIGHT: 24,
  DISCOVERY: 234,
};

function utilisationPct(seat: CodexSeat) {
  return seat.capUsdMonth > 0 ? (seat.mtdSpendUsd / seat.capUsdMonth) * 100 : 0;
}

async function getLadder() {
  const seats = await getOpenAIClient().listCodexSeats();

  const byTier: Record<Tier, CodexSeat[]> = {
    POWER: [],
    STANDARD: [],
    LIGHT: [],
    DISCOVERY: [],
  };
  for (const s of seats) byTier[s.subTier].push(s);
  for (const t of TIER_ORDER) byTier[t].sort((a, b) => b.mtdSpendUsd - a.mtdSpendUsd);

  // Promotion candidates — Discovery seats running hot. Real §4.6.2 rule is
  // ">=50% of cap for 2 consecutive months"; with 30 days of synthetic data
  // we use ">=50% MTD cap utilisation" as a proxy and surface it as such.
  const promotionCandidates = byTier.DISCOVERY
    .filter((s) => utilisationPct(s) >= 50)
    .sort((a, b) => utilisationPct(b) - utilisationPct(a))
    .slice(0, 10);

  // Demotion candidates — Power/Standard/Light seats running cold. Real rule
  // is "<10% for 3 consecutive months"; v0.2 uses MTD <10% as proxy.
  const demotionCandidates = [...byTier.POWER, ...byTier.STANDARD, ...byTier.LIGHT]
    .filter((s) => utilisationPct(s) < 10)
    .sort((a, b) => utilisationPct(a) - utilisationPct(b))
    .slice(0, 10);

  // Dormancy — Discovery with no allowed activity in 60+ days. Synthetic
  // data only spans 30 days, so this is mostly empty in dev; real data
  // makes it the §4.6.2 reclamation trigger.
  const dormancyCandidates = byTier.DISCOVERY
    .filter((s) => s.idleDays != null && s.idleDays >= 60)
    .sort((a, b) => (b.idleDays ?? 0) - (a.idleDays ?? 0))
    .slice(0, 10);

  return { byTier, promotionCandidates, demotionCandidates, dormancyCandidates, all: seats };
}

export default async function CodexLadderPage() {
  const data = await getLadder();
  const total = data.all.length;
  const totalSpend = data.all.reduce((s, x) => s + x.mtdSpendUsd, 0);
  const totalCap = data.all.reduce((s, x) => s + x.capUsdMonth, 0);

  return (
    <>
      <Topbar
        title="Codex Ladder"
        subtitle="F9 — distribution across Power / Standard / Light / Discovery; cap utilisation and promotion/demotion queues."
      />
      <div className="p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Codex seats" value={total} sub="from getOpenAIClient().listCodexSeats()" />
          <StatCard label="Aggregate MTD" value={formatUsd(totalSpend, { decimals: 0 })} sub={`of ${formatUsd(totalCap, { decimals: 0 })} cap`} />
          <StatCard label="Promotion candidates" value={data.promotionCandidates.length} sub="Discovery ≥ 50% cap" tone="emerald" />
          <StatCard label="Demotion candidates" value={data.demotionCandidates.length} sub="Power/Standard/Light < 10% cap" tone="amber" />
        </div>

        {/* Ladder distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Tier distribution</CardTitle>
            <CardDescription>
              Counts vs the §4.6.2 design quotas (Power 16 / Standard 40 / Light 24 /
              Discovery 234). v0.2 prototype runs at 30-user scale, so absolute counts
              differ; ratios should still show the funnel shape.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {TIER_ORDER.map((t) => {
                const seats = data.byTier[t];
                const tierCount = seats.length;
                const tierSpend = seats.reduce((s, x) => s + x.mtdSpendUsd, 0);
                const tierCap = seats.reduce((s, x) => s + x.capUsdMonth, 0);
                const utilisation = tierCap > 0 ? (tierSpend / tierCap) * 100 : 0;
                const styles = TIER_STYLES[t];
                const widthPct = total > 0 ? (tierCount / total) * 100 : 0;
                return (
                  <div key={t} className={cn("rounded-md p-4", styles.bg)}>
                    <div className="flex items-center justify-between gap-4">
                      <div className={cn("flex items-center gap-3", styles.text)}>
                        <Badge variant={styles.pill}>{CODEX_TIERS[t].label}</Badge>
                        <div className="text-sm">
                          <span className="font-mono font-semibold">{tierCount}</span>{" "}
                          seat{tierCount === 1 ? "" : "s"}{" "}
                          <span className="text-slate-500">
                            (design quota {TIER_QUOTAS[t].toLocaleString()})
                          </span>
                        </div>
                      </div>
                      <div className="text-sm text-slate-700 text-right">
                        <div className="font-mono">
                          {formatUsd(tierSpend, { decimals: 0 })}{" "}
                          <span className="text-slate-400">/</span>{" "}
                          {formatUsd(tierCap, { decimals: 0 })}
                        </div>
                        <div className="text-xs text-slate-500">
                          cap @ {formatUsd(CODEX_TIERS[t].capUsdMonth)}/seat ·{" "}
                          {utilisation.toFixed(1)}% MTD
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 h-2 w-full rounded bg-white">
                      <div
                        className={cn("h-2 rounded", styles.bar)}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Promotion / Demotion queues */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <QueueCard
            title="Promotion queue"
            description="Discovery seats at ≥50% of MTD cap. v0.2 proxy for §4.6.2 'two consecutive months ≥50%' once the time series is long enough."
            tone="emerald"
            seats={data.promotionCandidates}
          />
          <QueueCard
            title="Demotion queue"
            description="Power/Standard/Light seats at <10% of MTD cap. v0.2 proxy for §4.6.2 'three consecutive months <10%'."
            tone="amber"
            seats={data.demotionCandidates}
          />
        </div>

        {/* Dormancy */}
        <Card>
          <CardHeader>
            <CardTitle>Dormancy watch</CardTitle>
            <CardDescription>
              Discovery seats with no allowed activity in 60+ days. Real-data trigger
              for §4.6.4 reclamation. Synthetic seed only spans 30 days, so this list
              is usually empty in dev.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <SeatTable seats={data.dormancyCandidates} columns={["user", "tier", "lastActivity", "idleDays", "mtdSpend"]} emptyText="No seats meet the 60-day dormancy threshold in the synthetic dataset." />
          </CardContent>
        </Card>

        <p className="text-xs text-slate-400">
          v0.2 — read through <code className="font-mono">getOpenAIClient().listCodexSeats()</code>.
          Authoritative thresholds and promote/demote actions land in v1.1 once the
          consecutive-month window is real (scoping §5).
        </p>
      </div>
    </>
  );
}

function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  sub: string;
  tone?: "amber" | "emerald";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
        <div
          className={cn(
            "mt-1 text-2xl font-semibold",
            tone === "amber"
              ? "text-amber-700"
              : tone === "emerald"
                ? "text-emerald-700"
                : "text-slate-900",
          )}
        >
          {value}
        </div>
        <div className="text-xs text-slate-500 mt-0.5">{sub}</div>
      </CardContent>
    </Card>
  );
}

function QueueCard({
  title,
  description,
  tone,
  seats,
}: {
  title: string;
  description: string;
  tone: "emerald" | "amber";
  seats: CodexSeat[];
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <Badge variant={tone === "emerald" ? "success" : "warning"}>
            {seats.length}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <SeatTable
          seats={seats}
          columns={["user", "tier", "utilisation", "mtdSpend"]}
          emptyText={
            tone === "emerald"
              ? "No promotion candidates in the current window."
              : "No demotion candidates in the current window."
          }
        />
      </CardContent>
    </Card>
  );
}

function SeatTable({
  seats,
  columns,
  emptyText,
}: {
  seats: CodexSeat[];
  columns: ReadonlyArray<"user" | "tier" | "utilisation" | "lastActivity" | "idleDays" | "mtdSpend">;
  emptyText: string;
}) {
  if (seats.length === 0) {
    return <div className="px-5 py-8 text-sm text-slate-500">{emptyText}</div>;
  }
  return (
    <Table>
      <THead>
        <TR>
          {columns.map((col) => (
            <TH key={col} className={col === "user" ? "pl-5" : col === "mtdSpend" ? "text-right pr-5" : ""}>
              {COLUMN_LABEL[col]}
            </TH>
          ))}
        </TR>
      </THead>
      <TBody>
        {seats.map((s) => {
          const u = utilisationPct(s);
          return (
            <TR key={s.userId}>
              {columns.map((col) => {
                switch (col) {
                  case "user":
                    return (
                      <TD key="user" className="pl-5">
                        <div className="font-medium text-slate-900">{s.displayName}</div>
                        <div className="text-xs text-slate-500">{s.email}</div>
                      </TD>
                    );
                  case "tier":
                    return (
                      <TD key="tier">
                        <Badge variant={TIER_STYLES[s.subTier].pill}>{s.subTier}</Badge>
                      </TD>
                    );
                  case "utilisation":
                    return (
                      <TD key="util" className="font-mono">
                        {u.toFixed(1)}%
                      </TD>
                    );
                  case "lastActivity":
                    return (
                      <TD key="last" className="text-slate-600 font-mono text-xs">
                        {s.lastActivityTs
                          ? s.lastActivityTs.toISOString().slice(0, 10)
                          : "—"}
                      </TD>
                    );
                  case "idleDays":
                    return (
                      <TD key="idle" className="font-mono">
                        {s.idleDays == null ? "∞" : s.idleDays}
                      </TD>
                    );
                  case "mtdSpend":
                    return (
                      <TD key="mtd" className="text-right pr-5 font-mono">
                        {formatUsd(s.mtdSpendUsd, { decimals: 2 })}{" "}
                        <span className="text-slate-400">
                          / {formatUsd(s.capUsdMonth)}
                        </span>
                      </TD>
                    );
                }
              })}
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

const COLUMN_LABEL: Record<
  "user" | "tier" | "utilisation" | "lastActivity" | "idleDays" | "mtdSpend",
  string
> = {
  user: "User",
  tier: "Tier",
  utilisation: "% of cap",
  lastActivity: "Last activity",
  idleDays: "Idle days",
  mtdSpend: "MTD spend",
};
