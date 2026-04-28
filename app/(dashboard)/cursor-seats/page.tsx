import { Topbar } from "@/components/dashboard/topbar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { CURSOR_SEATS, CURSOR_TIERS, CURSOR_TOTAL_SEATS } from "@/lib/program";
import { cn, formatUsd, initials } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Seat =
  | { kind: "filled"; tier: "POWER" | "STANDARD" | "LIGHT"; userId: string; displayName: string; email: string; idleDays: number; mtdSpend: number; capUsd: number }
  | { kind: "empty"; tier: "POWER" | "STANDARD" | "LIGHT" };

async function getSeatBoard() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const seatLicenses = await prisma.license.findMany({
    where: { product: "CURSOR" },
    include: {
      user: { select: { id: true, displayName: true, email: true, region: true } },
    },
  });

  // Per-user MTD Cursor spend.
  const cursorMtd = await prisma.usageRecord.groupBy({
    by: ["userId"],
    where: { product: "CURSOR", ts: { gte: startOfMonth } },
    _sum: { costUsd: true },
  });
  const cursorMtdMap = new Map(cursorMtd.map((r) => [r.userId, r._sum.costUsd ?? 0]));

  // Idle days = days since last Cursor request.
  const lastSeen = await prisma.usageRecord.groupBy({
    by: ["userId"],
    where: { product: "CURSOR" },
    _max: { ts: true },
  });
  const lastSeenMap = new Map(lastSeen.map((r) => [r.userId, r._max.ts]));

  function tierFromSubTier(s: string): "POWER" | "STANDARD" | "LIGHT" | null {
    if (s === "cursor_power") return "POWER";
    if (s === "cursor_standard") return "STANDARD";
    if (s === "cursor_light") return "LIGHT";
    return null;
  }

  // Build the 84-cell board. We have N actual holders; pad with empty cells per
  // tier up to the design quotas in §4.6.1 (17 / 42 / 25).
  const cellsByTier: Record<"POWER" | "STANDARD" | "LIGHT", Seat[]> = {
    POWER: [],
    STANDARD: [],
    LIGHT: [],
  };

  for (const l of seatLicenses) {
    const tier = tierFromSubTier(l.subTier);
    if (!tier) continue;
    const last = lastSeenMap.get(l.userId);
    const idleDays = last
      ? Math.max(0, Math.floor((now.getTime() - new Date(last).getTime()) / (24 * 60 * 60 * 1000)))
      : 999;
    cellsByTier[tier].push({
      kind: "filled",
      tier,
      userId: l.userId,
      displayName: l.user.displayName,
      email: l.user.email,
      idleDays,
      mtdSpend: cursorMtdMap.get(l.userId) ?? 0,
      capUsd: l.capUsdMonth ?? CURSOR_TIERS[tier].capUsdMonth,
    });
  }

  // Pad with empty seats up to the design quotas for the visualisation.
  for (const tier of ["POWER", "STANDARD", "LIGHT"] as const) {
    const target = CURSOR_SEATS[tier];
    while (cellsByTier[tier].length < target) {
      cellsByTier[tier].push({ kind: "empty", tier });
    }
  }

  const all: Seat[] = [
    ...cellsByTier.POWER,
    ...cellsByTier.STANDARD,
    ...cellsByTier.LIGHT,
  ];

  // Synthetic waitlist — users with ChatGPT but no Cursor seat.
  const allUsers = await prisma.user.findMany({
    select: { id: true, displayName: true, email: true, roleTag: true },
  });
  const seatHolderIds = new Set(seatLicenses.map((l) => l.userId));
  const waitlist = allUsers
    .filter((u) => !seatHolderIds.has(u.id))
    .slice(0, 8)
    .map((u, i) => ({
      ...u,
      position: i + 1,
      requestedTier: i < 2 ? "POWER" : i < 5 ? "STANDARD" : "LIGHT",
      reason: [
        "Auto-promotion: 2 consecutive months >50% Codex Standard cap utilisation",
        "Manager attestation: dedicated agent-mode workload starting next quarter",
        "Backfill following hugo.liu reclamation",
        "New hire — onboarding cohort 2026-Q2",
        "Demoted from trial seat; re-applying with attestation",
        "Documentation team lead — mixed Cursor + Claude.ai workflow",
        "Contractor renewal — needs Cursor for new gaming-systems project",
        "Steering exception request pending",
      ][i],
    }));

  return { all, cellsByTier, waitlist };
}

export default async function CursorSeatsPage() {
  const data = await getSeatBoard();

  const filled = data.all.filter((s) => s.kind === "filled").length;
  const idle = data.all.filter((s) => s.kind === "filled" && s.idleDays >= 14).length;

  return (
    <>
      <Topbar
        title="Cursor Seat Board"
        subtitle="F4 — visualise the 84 seats; track holders, idle days, and the waitlist."
      />
      <div className="p-6 space-y-6">
        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total seats" value={CURSOR_TOTAL_SEATS} sub="design quota (§4.6.1)" />
          <StatCard label="Filled" value={filled} sub={`${CURSOR_TOTAL_SEATS - filled} open / waitlist eligible`} />
          <StatCard label="Idle ≥ 14 days" value={idle} sub="candidates for §4.6.4 review" tone="amber" />
          <StatCard label="Annual commitment" value={formatUsd(500_000)} sub="$41,667/mo" />
        </div>

        {/* Seat board */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <CardTitle>The 84 seats</CardTitle>
                <CardDescription>
                  Hover a cell for the holder + idle days. Empty cells are unallocated /
                  reclaimable per §4.6.4.
                </CardDescription>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <LegendDot color="bg-violet-500" label={`Power ${CURSOR_SEATS.POWER}`} />
                <LegendDot color="bg-sky-500" label={`Standard ${CURSOR_SEATS.STANDARD}`} />
                <LegendDot color="bg-slate-400" label={`Light ${CURSOR_SEATS.LIGHT}`} />
                <LegendDot color="bg-slate-200 border border-dashed border-slate-400" label="Empty" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <SeatGrid title="Power" tier="POWER" seats={data.cellsByTier.POWER} />
            <div className="h-3" />
            <SeatGrid title="Standard" tier="STANDARD" seats={data.cellsByTier.STANDARD} />
            <div className="h-3" />
            <SeatGrid title="Light" tier="LIGHT" seats={data.cellsByTier.LIGHT} />
          </CardContent>
        </Card>

        {/* Waitlist */}
        <Card>
          <CardHeader>
            <CardTitle>Waitlist (synthetic)</CardTitle>
            <CardDescription>
              Drawn from §4.6.4 priority order: bottom-36 trial users with attestation +
              loaner usage, new joiners with manager attestation, then Steering exceptions.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <Table>
              <THead>
                <TR>
                  <TH className="pl-5">#</TH>
                  <TH>User</TH>
                  <TH>Email</TH>
                  <TH>Role tag</TH>
                  <TH>Requested tier</TH>
                  <TH className="pr-5">Reason</TH>
                </TR>
              </THead>
              <TBody>
                {data.waitlist.map((w) => (
                  <TR key={w.id}>
                    <TD className="pl-5 font-mono text-slate-500">{w.position}</TD>
                    <TD className="font-medium text-slate-900">{w.displayName}</TD>
                    <TD className="text-slate-600">{w.email}</TD>
                    <TD>
                      <Badge variant="secondary">{w.roleTag}</Badge>
                    </TD>
                    <TD>
                      <Badge
                        variant={
                          w.requestedTier === "POWER"
                            ? "violet"
                            : w.requestedTier === "STANDARD"
                              ? "blue"
                              : "slate"
                        }
                      >
                        {w.requestedTier}
                      </Badge>
                    </TD>
                    <TD className="pr-5 text-slate-600 text-xs">{w.reason}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <p className="text-xs text-slate-400">
          v0.1 — write actions (seat grant / reclaim) deferred to v1.1 per scoping §5.
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
  tone?: "amber";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
        <div
          className={cn(
            "mt-1 text-2xl font-semibold",
            tone === "amber" ? "text-amber-700" : "text-slate-900",
          )}
        >
          {value}
        </div>
        <div className="text-xs text-slate-500 mt-0.5">{sub}</div>
      </CardContent>
    </Card>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-slate-600">
      <span className={cn("h-3 w-3 rounded", color)} />
      {label}
    </span>
  );
}

function SeatGrid({
  title,
  tier,
  seats,
}: {
  title: string;
  tier: "POWER" | "STANDARD" | "LIGHT";
  seats: Seat[];
}) {
  const colourFilled =
    tier === "POWER"
      ? "bg-violet-500 text-white"
      : tier === "STANDARD"
        ? "bg-sky-500 text-white"
        : "bg-slate-400 text-white";
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium text-slate-700">
          {title} <span className="text-slate-400 font-normal">· cap {formatUsd(CURSOR_TIERS[tier].capUsdMonth)}/mo</span>
        </div>
        <div className="text-xs text-slate-500">
          {seats.filter((s) => s.kind === "filled").length} / {seats.length} filled
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {seats.map((s, i) => {
          if (s.kind === "empty") {
            return (
              <span
                key={`e-${tier}-${i}`}
                className="inline-flex h-9 w-9 items-center justify-center rounded text-[10px] text-slate-400 border border-dashed border-slate-300 bg-slate-50"
                title={`Empty ${tier} seat`}
              >
                —
              </span>
            );
          }
          const idleHot = s.idleDays >= 30;
          const idleWarn = !idleHot && s.idleDays >= 14;
          const ring = idleHot
            ? "ring-2 ring-rose-400"
            : idleWarn
              ? "ring-2 ring-amber-400"
              : "";
          return (
            <span
              key={s.userId}
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded text-[11px] font-semibold cursor-default",
                colourFilled,
                ring,
              )}
              title={`${s.displayName} · ${s.email}\nIdle: ${s.idleDays} day${s.idleDays === 1 ? "" : "s"}\nMTD: ${formatUsd(s.mtdSpend, { decimals: 2 })} of ${formatUsd(s.capUsd)} cap`}
            >
              {initials(s.displayName)}
            </span>
          );
        })}
      </div>
    </div>
  );
}
