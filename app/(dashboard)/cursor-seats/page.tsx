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
import { CURSOR_RECLAMATION_IDLE_DAYS, CURSOR_TIERS } from "@/lib/program";
import { cn, formatPct, formatUsd, initials } from "@/lib/utils";
import { prisma } from "@/lib/prisma";
import { getCursorClient } from "@/lib/integrations";
import type {
  CursorClient,
  CursorSeat as ApiCursorSeat,
  CursorSubTier,
} from "@/lib/integrations";
import { enrichCursorSeatsWithVendorSpend } from "@/lib/integrations/cursor/enrich-cursor-seats-vendor-spend";
import { syntheticCursorClient } from "@/lib/integrations/cursor/synthetic";
import { getIntegrationMode } from "@/lib/integrations/env";
import { requireUser, userHasPermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac/permissions";

export const dynamic = "force-dynamic";

type SeatRow = {
  tier: CursorSubTier;
  userId: string;
  displayName: string;
  email: string;
  idleDays: number;
  mtdSpend: number;
  capUsd: number;
  /** False for SCIM workspace members without a dashboard License row. */
  hasProgramLicense: boolean;
};

const TIER_ORDER: readonly CursorSubTier[] = [
  "POWER",
  "STANDARD",
  "LIGHT",
  "DISCOVERY",
] as const;

function isScimOnlySeat(userId: string): boolean {
  return userId.startsWith("scim:");
}

function toSeatRow(s: ApiCursorSeat): SeatRow {
  return {
    tier: s.subTier,
    userId: s.userId,
    displayName: s.displayName,
    email: s.email,
    idleDays: s.idleDays ?? 999,
    mtdSpend: s.mtdSpendUsd,
    capUsd: CURSOR_TIERS[s.subTier].capUsdMonth,
    hasProgramLicense: !isScimOnlySeat(s.userId),
  };
}

async function loadSeatBoard(cursor: CursorClient) {
  const rawSeats = await cursor.listSeats();
  const seats = await enrichCursorSeatsWithVendorSpend(prisma, rawSeats);
  const waitlist = await cursor.listWaitlist();
  const rows = seats.map(toSeatRow);

  const byTier: Record<CursorSubTier, SeatRow[]> = {
    POWER: [],
    STANDARD: [],
    LIGHT: [],
    DISCOVERY: [],
  };
  for (const row of rows) {
    byTier[row.tier].push(row);
  }
  for (const tier of TIER_ORDER) {
    byTier[tier].sort((a, b) => b.mtdSpend - a.mtdSpend);
  }

  return { rows, byTier, waitlist };
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

function utilPct(row: SeatRow) {
  return row.capUsd > 0 ? (row.mtdSpend / row.capUsd) * 100 : 0;
}

function tierLabel(tier: CursorSubTier, hasProgramLicense: boolean): string {
  if (hasProgramLicense) return tier;
  return "Workspace";
}

export default async function CursorSeatsPage() {
  const user = await requireUser();
  const canManage =
    userHasPermission(user, PERMISSIONS.DECISIONS_APPROVE) &&
    userHasPermission(user, PERMISSIONS.POLICY_EDIT);

  const cursorMode = getIntegrationMode("cursor", process.env);
  const [data, openReclamations] = await Promise.all([
    getSeatBoard(),
    loadOpenReclamations(),
  ]);

  const { rows, byTier, waitlist } = data;
  const managedRows = rows.filter((r) => r.hasProgramLicense);
  const openReclamationUserIds = new Set(openReclamations.map((e) => e.subjectUserId));

  const reclamationCandidates = managedRows
    .filter((s) => s.idleDays >= CURSOR_RECLAMATION_IDLE_DAYS && !openReclamationUserIds.has(s.userId))
    .sort((a, b) => b.idleDays - a.idleDays)
    .slice(0, 10);

  const promotionCandidates = managedRows
    .filter((s) => s.tier === "DISCOVERY" && utilPct(s) >= 50)
    .sort((a, b) => utilPct(b) - utilPct(a))
    .slice(0, 10);

  const demotionCandidates = managedRows
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

  const memberCount = rows.length;
  const idle = rows.filter((s) => s.idleDays >= 14).length;
  const totalMtd = rows.reduce((acc, r) => acc + r.mtdSpend, 0);
  const scimOnlyCount = rows.filter((r) => !r.hasProgramLicense).length;

  const sortedMembers = [...rows].sort((a, b) => b.mtdSpend - a.mtdSpend);

  return (
    <>
      <Topbar
        title="Cursor workspace"
        subtitle="F4 — live workspace members from Cursor SCIM + program licenses; MTD from Team Admin sync."
      />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Workspace members"
            value={memberCount}
            sub={
              cursorMode === "real"
                ? "SCIM members unioned with dashboard licenses"
                : "Synthetic — Prisma License rows (dev)"
            }
          />
          <StatCard
            label="Program-licensed"
            value={managedRows.length}
            sub={
              scimOnlyCount > 0
                ? `${scimOnlyCount} in workspace without dashboard tier`
                : "All members have a program License row"
            }
          />
          <StatCard
            label="Idle ≥ 14 days"
            value={idle}
            sub="No Cursor usage in lookback window"
            tone="amber"
          />
          <StatCard
            label="MTD spend (all members)"
            value={formatUsd(totalMtd, { decimals: 0 })}
            sub="Team Admin VendorUserDailySpend when real"
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

        <Card>
          <CardHeader>
            <CardTitle>All members</CardTitle>
            <CardDescription>
              One row per person returned by{" "}
              <code className="font-mono">getCursorClient().listSeats()</code>. Real mode lists
              active SCIM workspace members; email match attaches program sub-tier and cap from
              dashboard <code className="font-mono">License</code> rows. Members without a license
              show tier <strong>Workspace</strong> (in Cursor, not yet tiered in the console).
              MTD and idle merge Team Admin{" "}
              <code className="font-mono">VendorUserDailySpend</code> when{" "}
              <code className="font-mono">INTEGRATION_CURSOR=real</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {sortedMembers.length === 0 ? (
              <p className="px-5 pb-6 text-sm text-slate-500">
                No workspace members returned. Check{" "}
                <code className="font-mono">CURSOR_SCIM_BASE_URL</code> and{" "}
                <code className="font-mono">CURSOR_ADMIN_TOKEN</code>, or run a roster import with
                Cursor licenses.
              </p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH className="pl-5">Member</TH>
                    <TH>Tier</TH>
                    <TH>MTD spend</TH>
                    <TH>Cap util</TH>
                    <TH className="pr-5">Idle</TH>
                  </TR>
                </THead>
                <TBody>
                  {sortedMembers.map((r) => (
                    <TR key={r.userId}>
                      <TD className="pl-5">
                        <div className="font-medium text-slate-900">{r.displayName}</div>
                        <div className="text-xs text-slate-500">{r.email}</div>
                      </TD>
                      <TD>
                        <Badge variant={r.hasProgramLicense ? tierBadge(r.tier) : "secondary"}>
                          {tierLabel(r.tier, r.hasProgramLicense)}
                        </Badge>
                      </TD>
                      <TD className="font-mono text-sm">{formatUsd(r.mtdSpend, { decimals: 2 })}</TD>
                      <TD className="text-sm">
                        {r.hasProgramLicense ? (
                          capUtilBadge(utilPct(r) / 100)
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </TD>
                      <TD className="pr-5">{idleBadge(r.idleDays)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {TIER_ORDER.some((t) => byTier[t].length > 0) ? (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <CardTitle>By program tier</CardTitle>
                  <CardDescription>
                    Compact view of licensed members only — counts reflect actual workspace data,
                    not a fixed allocation plan.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  {TIER_ORDER.map((tier) =>
                    byTier[tier].length > 0 ? (
                      <LegendDot
                        key={tier}
                        color={TIER_DOT[tier]}
                        label={`${CURSOR_TIERS[tier].label} (${byTier[tier].length})`}
                      />
                    ) : null,
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {TIER_ORDER.map((tier, i) =>
                byTier[tier].length > 0 ? (
                  <div key={tier}>
                    {i > 0 ? <div className="h-3" /> : null}
                    <SeatGrid
                      title={CURSOR_TIERS[tier].label}
                      tier={tier}
                      seats={byTier[tier]}
                    />
                  </div>
                ) : null,
              )}
            </CardContent>
          </Card>
        ) : null}

        {waitlist.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Waitlist</CardTitle>
              <CardDescription>
                Synthetic waitlist (dev only). Cursor does not expose a waitlist API — real mode
                returns an empty list.
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
                  {waitlist.map((w) => (
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
        ) : null}

        <p className="text-xs text-slate-400">
          F6 tier moves and F7 reclamation require a dashboard License row (not SCIM-only members).
          Synthetic mode uses example PR URLs when{" "}
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

const TIER_COLOURS: Record<CursorSubTier, string> = {
  POWER: "bg-violet-500 text-white",
  STANDARD: "bg-sky-500 text-white",
  LIGHT: "bg-slate-400 text-white",
  DISCOVERY: "bg-stone-300 text-stone-800",
};

const TIER_DOT: Record<CursorSubTier, string> = {
  POWER: "bg-violet-500",
  STANDARD: "bg-sky-500",
  LIGHT: "bg-slate-400",
  DISCOVERY: "bg-stone-300",
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

function tierBadge(t: CursorSubTier): "violet" | "blue" | "slate" | "secondary" {
  return WAITLIST_BADGE[t];
}

function capUtilBadge(util: number) {
  if (util >= 1.0) return <Badge variant="danger">{formatPct(util)}</Badge>;
  if (util >= 0.8) return <Badge variant="warning">{formatPct(util)}</Badge>;
  return <Badge variant="success">{formatPct(util)}</Badge>;
}

function idleBadge(days: number) {
  if (days >= 30) return <Badge variant="danger">{days}d</Badge>;
  if (days >= 14) return <Badge variant="warning">{days}d</Badge>;
  return <span className="text-slate-600 font-mono text-xs">{days}d</span>;
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
  seats: SeatRow[];
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
        <div className="text-xs text-slate-500">{seats.length} members</div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {seats.map((s) => {
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
              title={`${s.displayName} · ${s.email}\nIdle: ${s.idleDays} day${s.idleDays === 1 ? "" : "s"}\nMTD: ${formatUsd(s.mtdSpend, { decimals: 2 })}${s.hasProgramLicense ? ` of ${formatUsd(s.capUsd)} cap` : ""}`}
            >
              {initials(s.displayName)}
            </span>
          );
        })}
      </div>
    </div>
  );
}
