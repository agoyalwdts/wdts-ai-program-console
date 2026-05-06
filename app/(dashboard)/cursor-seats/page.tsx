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
import { CURSOR_SEATS, CURSOR_TIERS, CURSOR_TOTAL_SEATS } from "@/lib/program";
import { cn, formatUsd, initials } from "@/lib/utils";
import { getCursorClient } from "@/lib/integrations";
import type {
  CursorClient,
  CursorSeat as ApiCursorSeat,
  CursorSubTier,
} from "@/lib/integrations";
import { syntheticCursorClient } from "@/lib/integrations/cursor/synthetic";
import { getIntegrationMode } from "@/lib/integrations/env";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Cell =
  | {
      kind: "filled";
      tier: CursorSubTier;
      userId: string;
      displayName: string;
      email: string;
      idleDays: number;
      mtdSpend: number;
      capUsd: number;
    }
  | { kind: "empty"; tier: CursorSubTier };

// Render order for the seat board — top tier first, Discovery last,
// matching §4.6.1's "Discovery → Light → Standard → Power" promotion ladder
// (rendered top-down, so heaviest at the top).
const TIER_ORDER: readonly CursorSubTier[] = [
  "POWER",
  "STANDARD",
  "LIGHT",
  "DISCOVERY",
] as const;

async function loadSeatBoard(cursor: CursorClient) {
  const [seats, waitlist] = await Promise.all([
    cursor.listSeats(),
    cursor.listWaitlist(),
  ]);

  function toCell(s: ApiCursorSeat): Cell {
    return {
      kind: "filled",
      tier: s.subTier,
      userId: s.userId,
      displayName: s.displayName,
      email: s.email,
      idleDays: s.idleDays ?? 999,
      mtdSpend: s.mtdSpendUsd,
      capUsd: CURSOR_TIERS[s.subTier].capUsdMonth,
    };
  }

  const cellsByTier: Record<CursorSubTier, Cell[]> = {
    POWER: [],
    STANDARD: [],
    LIGHT: [],
    DISCOVERY: [],
  };
  for (const s of seats) cellsByTier[s.subTier].push(toCell(s));

  // Pad to the design quotas in §4.6.1 so the board always renders the full
  // 120-cell shape, even when only a subset of seats are filled.
  for (const tier of TIER_ORDER) {
    const target = CURSOR_SEATS[tier];
    while (cellsByTier[tier].length < target) {
      cellsByTier[tier].push({ kind: "empty", tier });
    }
  }

  const all: Cell[] = TIER_ORDER.flatMap((t) => cellsByTier[t]);

  return { all, cellsByTier, waitlist };
}

async function getSeatBoard() {
  const primary = getCursorClient();
  try {
    return await loadSeatBoard(primary);
  } catch (err) {
    if (getIntegrationMode("cursor", process.env) === "real") {
      console.error(
        "[cursor-seats] Primary Cursor client failed; falling back to synthetic (Prisma) board",
        err,
      );
      return await loadSeatBoard(syntheticCursorClient);
    }
    throw err;
  }
}

export default async function CursorSeatsPage() {
  await requireUser();
  const data = await getSeatBoard();

  const filled = data.all.filter((s) => s.kind === "filled").length;
  const idle = data.all.filter((s) => s.kind === "filled" && s.idleDays >= 14).length;

  return (
    <>
      <Topbar
        title="Cursor Seat Board"
        subtitle={`F4 — visualise the ${CURSOR_TOTAL_SEATS} seats; track holders, idle days, and the waitlist.`}
      />
      <div className="p-6 space-y-6">
        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Allocated seats"
            value={CURSOR_TOTAL_SEATS}
            sub="120-seat plan, four sub-tiers (§4.6.1)"
          />
          <StatCard
            label="Filled"
            value={filled}
            sub={`${CURSOR_TOTAL_SEATS - filled} open / waitlist eligible`}
          />
          <StatCard
            label="Idle ≥ 14 days"
            value={idle}
            sub="candidates for §4.6.4 review"
            tone="amber"
          />
          <StatCard
            label="Credit envelope"
            value={formatUsd(500_000)}
            sub="$41,667/mo · binding constraint (§4.6.1)"
          />
        </div>

        {/* Seat board */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <CardTitle>The {CURSOR_TOTAL_SEATS} seats</CardTitle>
                <CardDescription>
                  Vendor confirmed (April 2026) that Cursor is{" "}
                  <em>credit-capped, not seat-capped</em> — the binding constraint
                  is the $500K/yr envelope, not a seat count. The {CURSOR_TOTAL_SEATS}-seat
                  shape below is WDTS&apos;s allocation plan that fits inside the
                  envelope (~$41,400/mo cap-sum). Hover a cell for the holder + idle
                  days; empty cells are unallocated / reclaimable per §4.6.4. Source:{" "}
                  <code className="font-mono">getCursorClient().listSeats()</code>.
                </CardDescription>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <LegendDot color="bg-violet-500" label={`Power ${CURSOR_SEATS.POWER}`} />
                <LegendDot color="bg-sky-500" label={`Standard ${CURSOR_SEATS.STANDARD}`} />
                <LegendDot color="bg-slate-400" label={`Light ${CURSOR_SEATS.LIGHT}`} />
                <LegendDot color="bg-stone-300" label={`Discovery ${CURSOR_SEATS.DISCOVERY}`} />
                <LegendDot
                  color="bg-slate-200 border border-dashed border-slate-400"
                  label="Empty"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {TIER_ORDER.map((tier, i) => (
              <div key={tier}>
                {i > 0 ? <div className="h-3" /> : null}
                <SeatGrid
                  title={CURSOR_TIERS[tier].label}
                  tier={tier}
                  seats={data.cellsByTier[tier]}
                />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Waitlist */}
        <Card>
          <CardHeader>
            <CardTitle>Waitlist</CardTitle>
            <CardDescription>
              Drawn from §4.6.4 priority order: Discovery-tier users whose
              consumption justifies a Light promotion, Light → Standard, Standard
              → Power, then new joiners with manager attestation, then Steering
              exceptions. Source:{" "}
              <code className="font-mono">getCursorClient().listWaitlist()</code>.
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
                  <TR key={w.email}>
                    <TD className="pl-5 font-mono text-slate-500">{w.position}</TD>
                    <TD className="font-medium text-slate-900">{w.displayName}</TD>
                    <TD className="text-slate-600">{w.email}</TD>
                    <TD>
                      {w.roleTag ? (
                        <Badge variant="secondary">{w.roleTag}</Badge>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </TD>
                    <TD>
                      <Badge variant={waitlistBadge(w.requestedTier)}>
                        {w.requestedTier}
                      </Badge>
                    </TD>
                    <TD className="pr-5 text-slate-600 text-xs">{w.rationale}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <p className="text-xs text-slate-400">
          v0.2 — write actions (seat grant / reclaim) deferred to v1.1 per scoping §5.
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

// Per-tier visuals — kept in sync with §4.6.1's Discovery → Light → Standard
// → Power gradient. Discovery is the lightest because it's the floor of the
// promotion ladder and the lowest-cap tier.
const TIER_COLOURS: Record<CursorSubTier, string> = {
  POWER: "bg-violet-500 text-white",
  STANDARD: "bg-sky-500 text-white",
  LIGHT: "bg-slate-400 text-white",
  DISCOVERY: "bg-stone-300 text-stone-800",
};

const WAITLIST_BADGE: Record<CursorSubTier, "violet" | "blue" | "slate" | "secondary"> = {
  POWER: "violet",
  STANDARD: "blue",
  LIGHT: "slate",
  DISCOVERY: "secondary",
};

function waitlistBadge(t: CursorSubTier) {
  return WAITLIST_BADGE[t];
}

function SeatGrid({
  title,
  tier,
  seats,
}: {
  title: string;
  tier: CursorSubTier;
  seats: Cell[];
}) {
  const colourFilled = TIER_COLOURS[tier];
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium text-slate-700">
          {title}{" "}
          <span className="text-slate-400 font-normal">
            · cap {formatUsd(CURSOR_TIERS[tier].capUsdMonth)}/mo
          </span>
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
