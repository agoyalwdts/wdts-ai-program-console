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
import { BudgetBar } from "@/components/charts/budget-bar";
import { prisma } from "@/lib/prisma";
import { PRODUCTS, type ProductKey } from "@/lib/program";
import { formatUsd, initials } from "@/lib/utils";
import { getGatewayClient } from "@/lib/integrations";

export const dynamic = "force-dynamic";

type SP = { month?: string };

function parseMonth(spec: string | undefined): { start: Date; end: Date; label: string; isCurrent: boolean } {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth();
  if (spec) {
    const m = spec.match(/^(\d{4})-(\d{2})$/);
    if (m) {
      year = Number(m[1]);
      month = Number(m[2]) - 1;
    }
  }
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 1);
  // Cap end at now() if this is the current month so MTD math behaves.
  const cappedEnd = end.getTime() > now.getTime() ? now : end;
  const label = start.toLocaleString("en-US", { month: "long", year: "numeric" });
  const isCurrent = start.getMonth() === now.getMonth() && start.getFullYear() === now.getFullYear();
  return { start, end: cappedEnd, label, isCurrent };
}

type Member = {
  userId: string;
  email: string;
  displayName: string;
  region: string;
  roleTag: string | null;
  spendByProduct: Record<ProductKey, number>;
  totalSpend: number;
  budgetByProduct: Record<ProductKey, number>;
  totalBudget: number;
};

type Team = {
  /** "manager:<userId>" or "no-manager". */
  key: string;
  managerId: string | null;
  managerName: string;
  managerEmail: string | null;
  /** Includes the manager themselves if they have a direct usage trail. */
  members: Member[];
  totalSpend: number;
  totalBudget: number;
  spendByProduct: Record<ProductKey, number>;
  budgetByProduct: Record<ProductKey, number>;
};

function emptyProductMap(): Record<ProductKey, number> {
  const m = {} as Record<ProductKey, number>;
  for (const p of PRODUCTS) m[p.key] = 0;
  return m;
}

async function getChargeback(spec: string | undefined) {
  const period = parseMonth(spec);

  const [users, licenses, aggs] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        email: true,
        displayName: true,
        region: true,
        roleTag: true,
        managerId: true,
        manager: { select: { id: true, displayName: true, email: true } },
      },
      orderBy: { displayName: "asc" },
    }),
    prisma.license.findMany({
      select: { userId: true, product: true, capUsdMonth: true },
    }),
    getGatewayClient().aggregateByUser({
      periodStart: period.start,
      periodEnd: period.end,
    }),
  ]);

  // Build per-user spend + budget maps.
  const spendByUser = new Map<string, Record<ProductKey, number>>();
  for (const a of aggs) {
    const m = spendByUser.get(a.userId) ?? emptyProductMap();
    m[a.product as ProductKey] = (m[a.product as ProductKey] ?? 0) + a.totalUsd;
    spendByUser.set(a.userId, m);
  }
  const budgetByUser = new Map<string, Record<ProductKey, number>>();
  for (const l of licenses) {
    const m = budgetByUser.get(l.userId) ?? emptyProductMap();
    m[l.product as ProductKey] = (m[l.product as ProductKey] ?? 0) + (l.capUsdMonth ?? 0);
    budgetByUser.set(l.userId, m);
  }

  // Build team buckets keyed by manager (or "no-manager" for top-level users).
  const teams = new Map<string, Team>();
  function getTeam(u: (typeof users)[number]): Team {
    if (u.manager) {
      const key = `manager:${u.manager.id}`;
      let team = teams.get(key);
      if (!team) {
        team = {
          key,
          managerId: u.manager.id,
          managerName: u.manager.displayName,
          managerEmail: u.manager.email,
          members: [],
          totalSpend: 0,
          totalBudget: 0,
          spendByProduct: emptyProductMap(),
          budgetByProduct: emptyProductMap(),
        };
        teams.set(key, team);
      }
      return team;
    }
    let team = teams.get("no-manager");
    if (!team) {
      team = {
        key: "no-manager",
        managerId: null,
        managerName: "Unmanaged / top-level",
        managerEmail: null,
        members: [],
        totalSpend: 0,
        totalBudget: 0,
        spendByProduct: emptyProductMap(),
        budgetByProduct: emptyProductMap(),
      };
      teams.set("no-manager", team);
    }
    return team;
  }

  for (const u of users) {
    if (u.managerId == null) continue; // managers themselves form their own row only as a destination.
    const team = getTeam(u);
    const spend = spendByUser.get(u.id) ?? emptyProductMap();
    const budget = budgetByUser.get(u.id) ?? emptyProductMap();
    let totalSpend = 0;
    let totalBudget = 0;
    for (const p of PRODUCTS) {
      totalSpend += spend[p.key];
      totalBudget += budget[p.key];
      team.spendByProduct[p.key] += spend[p.key];
      team.budgetByProduct[p.key] += budget[p.key];
    }
    team.members.push({
      userId: u.id,
      email: u.email,
      displayName: u.displayName,
      region: u.region,
      roleTag: u.roleTag,
      spendByProduct: spend,
      totalSpend,
      budgetByProduct: budget,
      totalBudget,
    });
    team.totalSpend += totalSpend;
    team.totalBudget += totalBudget;
  }

  // Stable sort: descending by totalSpend (biggest bills first).
  const teamRows = Array.from(teams.values())
    .filter((t) => t.members.length > 0)
    .sort((a, b) => b.totalSpend - a.totalSpend);

  for (const t of teamRows) {
    t.members.sort((a, b) => b.totalSpend - a.totalSpend);
  }

  const programTotal = teamRows.reduce((s, t) => s + t.totalSpend, 0);
  const programBudget = teamRows.reduce((s, t) => s + t.totalBudget, 0);
  const programOverage = teamRows.reduce(
    (s, t) => s + Math.max(0, t.totalSpend - t.totalBudget),
    0,
  );

  return { period, teamRows, programTotal, programBudget, programOverage };
}

export default async function ChargebackPage(props: { searchParams: Promise<SP> }) {
  const sp = await props.searchParams;
  const data = await getChargeback(sp.month);

  return (
    <>
      <Topbar
        title="Chargeback"
        subtitle="F10 — per-team monthly bill, with overage flagged. v0.2 groups by reporting line; v0.3 will key on a real cost-centre field."
      />
      <div className="p-6 space-y-6">
        {/* Period + program totals */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <CardTitle>{data.period.label}</CardTitle>
                <CardDescription>
                  {data.period.isCurrent
                    ? "Current month — month-to-date."
                    : "Closed month."}{" "}
                  Source:{" "}
                  <code className="font-mono">
                    getGatewayClient().aggregateByUser
                  </code>
                  ; budget = sum of License caps from the local cache.
                </CardDescription>
              </div>
              <div className="flex items-center gap-4">
                <Stat label="Program spend" value={formatUsd(data.programTotal, { decimals: 0 })} />
                <Stat label="Program budget" value={formatUsd(data.programBudget, { decimals: 0 })} />
                <Stat
                  label="Overage"
                  value={formatUsd(data.programOverage, { decimals: 0 })}
                  tone={data.programOverage > 0 ? "rose" : "emerald"}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <BudgetBar spend={data.programTotal} budget={data.programBudget} warnAt={0.85} />
          </CardContent>
        </Card>

        {/* Per-team breakdown */}
        {data.teamRows.length === 0 ? (
          <Card>
            <CardContent className="p-10 text-sm text-slate-500">
              No usage in this billing window.
            </CardContent>
          </Card>
        ) : (
          data.teamRows.map((t) => <TeamCard key={t.key} team={t} />)
        )}

        <p className="text-xs text-slate-400">
          v0.2 — teams = manager + their direct reports (the schema has no
          cost-centre field yet). v0.3 adds <code className="font-mono">User.costCentre</code>{" "}
          and a CSV export per scoping §2 v1.1.
        </p>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "rose" | "emerald";
}) {
  return (
    <div className="text-right">
      <div
        className={
          "text-xl font-semibold " +
          (tone === "rose"
            ? "text-rose-700"
            : tone === "emerald"
              ? "text-emerald-700"
              : "text-slate-900")
        }
      >
        {value}
      </div>
      <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
    </div>
  );
}

function TeamCard({ team }: { team: Team }) {
  const overage = Math.max(0, team.totalSpend - team.totalBudget);
  const overBudget = team.totalSpend > team.totalBudget;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-slate-200 text-slate-700 text-xs font-semibold inline-flex items-center justify-center">
              {initials(team.managerName)}
            </div>
            <div>
              <CardTitle>{team.managerName}</CardTitle>
              <CardDescription>
                {team.members.length} member{team.members.length === 1 ? "" : "s"}
                {team.managerEmail ? <> · {team.managerEmail}</> : null}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Stat label="Spend" value={formatUsd(team.totalSpend, { decimals: 0 })} />
            <Stat label="Budget" value={formatUsd(team.totalBudget, { decimals: 0 })} />
            <Stat
              label={overBudget ? "Overage" : "Headroom"}
              value={formatUsd(
                overBudget ? overage : team.totalBudget - team.totalSpend,
                { decimals: 0 },
              )}
              tone={overBudget ? "rose" : "emerald"}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <BudgetBar
          spend={team.totalSpend}
          budget={team.totalBudget || 1}
          warnAt={0.85}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 text-xs">
          {PRODUCTS.map(({ key, label }) => {
            const s = team.spendByProduct[key];
            const b = team.budgetByProduct[key];
            const isOver = s > b && b > 0;
            return (
              <div
                key={key}
                className={
                  "rounded-md border px-3 py-2 " +
                  (isOver
                    ? "border-rose-200 bg-rose-50"
                    : "border-slate-200 bg-slate-50")
                }
              >
                <div className="text-[11px] uppercase tracking-wider text-slate-500">
                  {label}
                </div>
                <div className="mt-0.5 font-mono text-slate-900">
                  {formatUsd(s, { decimals: 0 })}
                  <span className="text-slate-400"> / {formatUsd(b, { decimals: 0 })}</span>
                </div>
              </div>
            );
          })}
        </div>
        <details className="group">
          <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">
            Show {team.members.length} member{team.members.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-3">
            <Table>
              <THead>
                <TR>
                  <TH className="pl-5">Member</TH>
                  <TH>Role tag</TH>
                  <TH>Region</TH>
                  <TH className="text-right">Spend</TH>
                  <TH className="text-right">Budget</TH>
                  <TH className="text-right pr-5">Δ</TH>
                </TR>
              </THead>
              <TBody>
                {team.members.map((m) => {
                  const delta = m.totalSpend - m.totalBudget;
                  return (
                    <TR key={m.userId}>
                      <TD className="pl-5">
                        <div className="font-medium text-slate-900">{m.displayName}</div>
                        <div className="text-xs text-slate-500">{m.email}</div>
                      </TD>
                      <TD>
                        {m.roleTag ? (
                          <Badge variant="secondary">{m.roleTag}</Badge>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </TD>
                      <TD>
                        <Badge variant={m.region === "apac-mo" ? "warning" : "outline"}>
                          {m.region}
                        </Badge>
                      </TD>
                      <TD className="text-right font-mono">
                        {formatUsd(m.totalSpend, { decimals: 2 })}
                      </TD>
                      <TD className="text-right font-mono text-slate-500">
                        {formatUsd(m.totalBudget, { decimals: 0 })}
                      </TD>
                      <TD className="text-right pr-5 font-mono">
                        <span
                          className={
                            delta > 0
                              ? "text-rose-700"
                              : delta < 0
                                ? "text-slate-500"
                                : "text-slate-400"
                          }
                        >
                          {delta > 0 ? "+" : ""}
                          {formatUsd(delta, { decimals: 0 })}
                        </span>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
