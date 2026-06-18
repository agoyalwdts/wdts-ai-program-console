import type { ReactNode } from "react";
import { Topbar } from "@/components/dashboard/topbar";
import { CursorTierMoveButton } from "@/components/dashboard/cursor-tier-move-button";
import {
  ActiveReclamationsPanel,
  ReclamationTriggerButton,
  type ReclamationRow,
} from "@/components/dashboard/reclamation-actions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CURSOR_RECLAMATION_IDLE_DAYS, CURSOR_SEATS, CURSOR_TIERS, CURSOR_TOTAL_SEATS } from "@/lib/program";
import { cn, formatUsd, initials } from "@/lib/utils";
import { prisma } from "@/lib/prisma";
import { getCursorClient } from "@/lib/integrations";
import type {
  CursorClient,
  CursorSeat as ApiCursorSeat,
  CursorSubTier,
} from "@/lib/integrations";
import { syntheticCursorClient } from "@/lib/integrations/cursor/synthetic";
import { getIntegrationMode } from "@/lib/integrations/env";
import { requireUser, userHasPermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac/permissions";

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

async function loadOpenReclamations() {
  return prisma.reclamationEvent.findMany({
    where: { state: { in: ["NOTIFIED", "IN_DISPUTE"] } },
    include: {
      subject: { include: { manager: true } },
      license: true,
    },
    orderBy: { triggeredAt: "desc" },
  });
}

function filledCells(all: Cell[]): Extract<Cell, { kind: "filled" }>[] {
  return all.filter((c): c is Extract<Cell, { kind: "filled" }> => c.kind === "filled");
}

function utilPct(cell: Extract<Cell, { kind: "filled" }>) {
  return cell.capUsd > 0 ? (cell.mtdSpend / cell.capUsd) * 100 : 0;
}

export default async function CursorSeatsPage() {
  const user = await requireUser();
  const canManage =
    userHasPermission(user, PERMISSIONS.DECISIONS_APPROVE) &&
    userHasPermission(user, PERMISSIONS.POLICY_EDIT);

  const [data, openReclamations] = await Promise.all([
    getSeatBoard(),
    loadOpenReclamations(),
  ]);

  const filled = filledCells(data.all);
  const openReclamationUserIds = new Set(openReclamations.map((e) => e.subjectUserId));

  const reclamationCandidates = filled
    .filter((s) => s.idleDays >= CURSOR_RECLAMATION_IDLE_DAYS && !openReclamationUserIds.has(s.userId))
    .sort((a, b) => b.idleDays - a.idleDays)
    .slice(0, 10);

  const promotionCandidates = filled
    .filter((s) => s.tier === "DISCOVERY" && utilPct(s) >= 50)
    .sort((a, b) => utilPct(b) - utilPct(a))
    .slice(0, 10);

  const demotionCandidates = filled
    .filter(
      (s) =>
        (s.tier === "POWER" || s.tier === "STANDARD" || s.tier === "LIGHT") && utilPct(s) < 10,
    )
    .sort((a, b) => utilPct(a) - utilPct(b))
    .slice(0, 10);

  const actorEmailLower = user.email.toLowerCase();
  const reclamationRows: ReclamationRow[] = openReclamations.map((e) => {
    const subjectEmail = e.subject.email.toLowerCase();
    const managerEmail = e.subject.manager?.email.toLowerCase();
    const isSubjectOrManager =
      actorEmailLower === subjectEmail || actorEmailLower === managerEmail;
    return {
      id: e.id,
      state: e.state,
      subjectUserId: e.subjectUserId,
      subjectEmail: e.subject.email,
      subjectDisplayName: e.subject.displayName,
      disputeWindowEndsAt: e.disputeWindowEndsAt?.toISOString() ?? null,
      canDispute: e.state === "NOTIFIED" && isSubjectOrManager,
      canResolve: canManage,
    };
  });

  const filledCount = filled.length;
  const idle = filled.filter((s) => s.idleDays >= 14).length;

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
            value={filledCount}
            sub={`${CURSOR_TOTAL_SEATS - filledCount} open / waitlist eligible`}
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

        {reclamationRows.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Active reclamations (F7)</CardTitle>
              <CardDescription>
                Open dispute windows and in-review disputes. Cron{" "}
                <code className="font-mono">POST /api/cron/reconcile-reclamations</code> auto-reclaims
                when the window expires.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ActiveReclamationsPanel rows={reclamationRows} />
            </CardContent>
          </Card>
        )}

        {(canManage && (reclamationCandidates.length > 0 || promotionCandidates.length > 0 || demotionCandidates.length > 0)) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {reclamationCandidates.length > 0 && (
              <ActionQueueCard
                title="Reclamation candidates"
                description={`Idle ≥ ${CURSOR_RECLAMATION_IDLE_DAYS} days — opens a 5-business-day dispute window.`}
                rows={reclamationCandidates.map((s) => ({
                  key: s.userId,
                  name: s.displayName,
                  email: s.email,
                  meta: `${s.idleDays}d idle · ${s.tier}`,
                  action: (
                    <ReclamationTriggerButton
                      userId={s.userId}
                      email={s.email}
                      displayName={s.displayName}
                      idleDays={s.idleDays}
                    />
                  ),
                }))}
              />
            )}
            {promotionCandidates.length > 0 && (
              <ActionQueueCard
                title="Promotion queue (F6)"
                description="Discovery seats at ≥50% MTD cap."
                rows={promotionCandidates.map((s) => ({
                  key: s.userId,
                  name: s.displayName,
                  email: s.email,
                  meta: `${utilPct(s).toFixed(1)}% of cap`,
                  action: (
                    <CursorTierMoveButton
                      userId={s.userId}
                      email={s.email}
                      displayName={s.displayName}
                      currentTier={s.tier}
                      direction="promote"
                    />
                  ),
                }))}
              />
            )}
            {demotionCandidates.length > 0 && (
              <ActionQueueCard
                title="Demotion queue (F6)"
                description="Power / Standard / Light seats below 10% MTD cap."
                rows={demotionCandidates.map((s) => ({
                  key: s.userId,
                  name: s.displayName,
                  email: s.email,
                  meta: `${utilPct(s).toFixed(1)}% of cap · ${s.tier}`,
                  action: (
                    <CursorTierMoveButton
                      userId={s.userId}
                      email={s.email}
                      displayName={s.displayName}
                      currentTier={s.tier}
                      direction="demote"
                    />
                  ),
                }))}
              />
            )}
          </div>
        )}

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
                  <code className="font-mono">getCursorClient().listSeats()</code>
                  — synthetic mode uses Prisma <code className="font-mono">License</code>{" "}
                  (<code className="font-mono">CURSOR</code>) only. Real mode unions{" "}
                  <strong>SCIM workspace members</strong> with those licenses (email match keeps
                  tier / MTD from the DB; SCIM-only rows show as Standard until licensed).
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
          F6 tier moves and F7 reclamation open policy-repo PRs — the seat board mirror updates after
          merge. Synthetic mode uses example PR URLs when{" "}
          <code className="font-mono">INTEGRATION_POLICYREPO=synthetic</code>.
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

function ActionQueueCard({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: { key: string; name: string; email: string; meta: string; action: ReactNode }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <Table>
          <THead>
            <TR>
              <TH className="pl-5">User</TH>
              <TH>Detail</TH>
              <TH className="text-right pr-5">Action</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.key}>
                <TD className="pl-5">
                  <div className="font-medium text-slate-900">{r.name}</div>
                  <div className="text-xs text-slate-500">{r.email}</div>
                </TD>
                <TD className="text-sm text-slate-600 font-mono">{r.meta}</TD>
                <TD className="text-right pr-5">{r.action}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  );
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
