import Link from "next/link";
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
import { PRODUCTS } from "@/lib/program";
import { formatUsd, initials, cn } from "@/lib/utils";
import { requireUser } from "@/lib/auth";
import {
  loadChargebackData,
  type ChargebackTeam,
} from "@/lib/chargeback/load-chargeback-data";

function chargebackHref(groupBy: string, month?: string): string {
  const params = new URLSearchParams({ groupBy });
  if (month) params.set("month", month);
  return `/chargeback?${params.toString()}`;
}

export const dynamic = "force-dynamic";

type SP = { month?: string; groupBy?: string };

export default async function ChargebackPage(props: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await props.searchParams;
  const data = await loadChargebackData(prisma, {
    month: sp.month,
    groupBy: sp.groupBy,
  });

  const monthQuery = sp.month;

  const sourceLabel = data.spendMeta.usedVendorMirror
    ? "VendorUserDailySpend + snapshots (Unified Credits COSTS preferred; gateway fallback)"
    : "gateway UsageRecord mirror";

  return (
    <>
      <Topbar
        title="Chargeback"
        subtitle="F10 — per-team monthly bill with overage flagged. Group by reporting line or FinOps cost centre."
      />
      <div className="p-6 space-y-6">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">Group by:</span>
          <Link
            href={chargebackHref("manager", monthQuery)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
              data.groupBy === "manager"
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
            )}
          >
            Manager line
          </Link>
          <Link
            href={chargebackHref("cost-centre", monthQuery)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
              data.groupBy === "cost-centre"
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
            )}
          >
            Cost centre
          </Link>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <CardTitle>{data.period.label}</CardTitle>
                <CardDescription>
                  {data.period.isCurrent
                    ? "Current month — month-to-date."
                    : "Closed month."}{" "}
                  Source: {sourceLabel}; budget = sum of License caps from the local cache.
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

        {data.teamRows.length === 0 ? (
          <Card>
            <CardContent className="p-10 text-sm text-slate-500">
              No usage or budget in this billing window.
            </CardContent>
          </Card>
        ) : (
          data.teamRows.map((t) => <TeamCard key={t.key} team={t} groupBy={data.groupBy} />)
        )}

        <p className="text-xs text-slate-400">
          Spend merges vendor mirrors (Cursor Team Admin, ChatGPT/Codex snapshots, Unified
          Credits COSTS when synced) with the gateway UsageRecord fallback — same path as the
          Users page. Only members with spend or a license cap appear. Manager grouping uses{" "}
          <code className="font-mono">User.managerId</code> from the Azure AD reconciler;
          cost-centre grouping uses <code className="font-mono">User.costCentre</code> (ADR 0002).
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

function TeamCard({
  team,
  groupBy,
}: {
  team: ChargebackTeam;
  groupBy: "manager" | "cost-centre";
}) {
  const overage = Math.max(0, team.totalSpend - team.totalBudget);
  const overBudget = team.totalSpend > team.totalBudget;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-slate-200 text-slate-700 text-xs font-semibold inline-flex items-center justify-center">
              {initials(team.headerName)}
            </div>
            <div>
              <CardTitle>{team.headerName}</CardTitle>
              <CardDescription>
                {team.members.length} member{team.members.length === 1 ? "" : "s"}
                {team.headerSubtitle ? <> · {team.headerSubtitle}</> : null}
                {groupBy === "cost-centre" ? <> · FinOps showback</> : null}
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
                  {groupBy === "cost-centre" ? <TH>Manager line</TH> : <TH>Cost centre</TH>}
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
                        {groupBy === "cost-centre" ? (
                          m.managerDisplayName ? (
                            <span className="text-xs text-slate-700">{m.managerDisplayName}</span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )
                        ) : m.costCentre ? (
                          <Badge variant="outline">{m.costCentre}</Badge>
                        ) : (
                          <span className="text-xs text-slate-400">Unassigned</span>
                        )}
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
