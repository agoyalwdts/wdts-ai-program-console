/**
 * F3 — Per-manager queue (scoping §2 v1 row 3 / §3.2 v_manager_queue).
 *
 * Answers: "Of my 8 direct reports, who is at >80% of cap, who is idle 30+
 * days, who has a pending tier-move recommendation?"
 *
 * v0.2 wiring:
 *   - Direct-report aggregates come through `getGatewayClient().managerQueue()`
 *     so this page already runs against the synthetic-vs-real boundary
 *     (scoping §4). Flipping `INTEGRATION_GATEWAY=real` in staging swaps the
 *     data source without touching this file.
 *   - "Pending recommendations" are surfaced from `Decision` rows of type
 *     RECLAMATION whose `afterState.state === 'NOTIFIED'`. v0.2 will add
 *     `ReclamationEvent` / `ExceptionRequest` models per scoping §3.1 and
 *     this page should switch to those once they exist (TODO(v0.2)).
 */

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
import { prisma } from "@/lib/prisma";
import { formatPct, formatUsd, initials } from "@/lib/utils";
import { PRODUCTS, type ProductKey } from "@/lib/program";
import { getGatewayClient } from "@/lib/integrations";
import { ChevronRight, AlertTriangle, Users as UsersIcon } from "lucide-react";

export const dynamic = "force-dynamic";

type SP = { manager?: string };

type ManagerSummary = {
  id: string;
  email: string;
  displayName: string;
  reportCount: number;
  overCapCount: number;
  idleCount: number;
  pendingCount: number;
};

const OVER_CAP_THRESHOLD = 0.8;
const IDLE_THRESHOLD_DAYS = 14;

async function getManagerSummaries(): Promise<ManagerSummary[]> {
  const managers = await prisma.user.findMany({
    where: { reports: { some: {} } },
    include: {
      reports: { select: { id: true } },
    },
    orderBy: { displayName: "asc" },
  });

  const gateway = getGatewayClient();
  const summaries: ManagerSummary[] = [];

  // Fan-out per manager. With 30 users this is fine; for v1 prod
  // (~30 managers × ~6 reports avg) it's still well under a second total.
  // If we outgrow that, materialise `v_manager_queue` (scoping §3.2) and
  // read it directly.
  for (const m of managers) {
    const rows = await gateway.managerQueue({ managerUserId: m.id });
    let overCap = 0;
    let idle = 0;
    for (const r of rows) {
      const max = Math.max(
        ...Object.values(r.capUtilisation).map((v) => v ?? 0),
      );
      if (max >= OVER_CAP_THRESHOLD) overCap++;
      if (r.idleDays != null && r.idleDays >= IDLE_THRESHOLD_DAYS) idle++;
    }

    const reportIds = m.reports.map((r) => r.id);
    const pending = await prisma.decision.count({
      where: {
        subjectUserId: { in: reportIds },
        type: "RECLAMATION",
        afterState: { contains: '"NOTIFIED"' },
      },
    });

    summaries.push({
      id: m.id,
      email: m.email,
      displayName: m.displayName,
      reportCount: rows.length,
      overCapCount: overCap,
      idleCount: idle,
      pendingCount: pending,
    });
  }

  return summaries;
}

async function getQueueForManager(managerUserId: string) {
  const gateway = getGatewayClient();
  const rows = await gateway.managerQueue({ managerUserId });

  const reportIds = rows.map((r) => r.userId);
  const pendingByUser = new Map<string, { type: string; justification: string; ts: Date }[]>();
  if (reportIds.length > 0) {
    const decisions = await prisma.decision.findMany({
      where: {
        subjectUserId: { in: reportIds },
        type: { in: ["RECLAMATION", "EXCEPTION_GRANT", "TIER_DEMOTION"] },
      },
      orderBy: { ts: "desc" },
      take: 50,
    });
    for (const d of decisions) {
      if (!d.subjectUserId) continue;
      const arr = pendingByUser.get(d.subjectUserId) ?? [];
      arr.push({ type: d.type, justification: d.justification, ts: d.ts });
      pendingByUser.set(d.subjectUserId, arr);
    }
  }

  return rows.map((r) => ({
    ...r,
    recentDecisions: pendingByUser.get(r.userId) ?? [],
  }));
}

function capUtilBadge(util: number | null) {
  if (util == null) return <span className="text-slate-300">—</span>;
  if (util >= 1.0) return <Badge variant="danger">{formatPct(util)}</Badge>;
  if (util >= OVER_CAP_THRESHOLD) return <Badge variant="warning">{formatPct(util)}</Badge>;
  return <Badge variant="success">{formatPct(util)}</Badge>;
}

function idleBadge(days: number | null) {
  if (days == null) return <span className="text-slate-300">—</span>;
  if (days >= 30) return <Badge variant="danger">{days}d</Badge>;
  if (days >= IDLE_THRESHOLD_DAYS) return <Badge variant="warning">{days}d</Badge>;
  return <span className="text-slate-600 font-mono text-xs">{days}d</span>;
}

export default async function ManagersPage(props: { searchParams: Promise<SP> }) {
  const sp = await props.searchParams;
  const managers = await getManagerSummaries();
  const selectedId = sp.manager || managers[0]?.id;
  const selected = managers.find((m) => m.id === selectedId) ?? null;
  const queue = selected ? await getQueueForManager(selected.id) : [];

  return (
    <>
      <Topbar
        title="Manager Queue"
        subtitle="F3 — each manager sees their direct reports' cap utilisation, idle days, and pending tier-move / reclamation recommendations."
      />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>Managers</CardTitle>
              <CardDescription>
                {managers.length} manager{managers.length === 1 ? "" : "s"} with at
                least one direct report. Counts surface reports {">"}={" "}
                {Math.round(OVER_CAP_THRESHOLD * 100)}% of any product cap, idle ≥{" "}
                {IDLE_THRESHOLD_DAYS}d, or with a recent reclamation /
                exception / demotion in the decision log.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <ul className="divide-y divide-slate-100 max-h-[680px] overflow-y-auto">
                {managers.map((m) => {
                  const isActive = m.id === selectedId;
                  return (
                    <li key={m.id}>
                      <Link
                        href={`/managers?manager=${m.id}`}
                        className={
                          "flex items-center gap-3 px-5 py-3 text-sm hover:bg-slate-50 transition-colors " +
                          (isActive ? "bg-slate-100" : "")
                        }
                      >
                        <div className="h-8 w-8 rounded-full bg-slate-200 text-slate-700 text-xs font-semibold inline-flex items-center justify-center">
                          {initials(m.displayName)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-slate-900 truncate">
                            {m.displayName}
                          </div>
                          <div className="text-xs text-slate-500 truncate">
                            {m.reportCount} report{m.reportCount === 1 ? "" : "s"}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          {m.overCapCount > 0 ? (
                            <Badge variant="warning">{m.overCapCount} hot</Badge>
                          ) : null}
                          {m.idleCount > 0 ? (
                            <Badge variant="secondary">{m.idleCount} idle</Badge>
                          ) : null}
                          {m.pendingCount > 0 ? (
                            <Badge variant="danger">{m.pendingCount} pending</Badge>
                          ) : null}
                        </div>
                        <ChevronRight className="h-4 w-4 text-slate-300" />
                      </Link>
                    </li>
                  );
                })}
                {managers.length === 0 ? (
                  <li className="p-5 text-sm text-slate-500">
                    No managers in the directory yet.
                  </li>
                ) : null}
              </ul>
            </CardContent>
          </Card>

          <div className="lg:col-span-2 space-y-4">
            {selected ? (
              <ManagerQueue
                manager={selected}
                queue={queue}
              />
            ) : (
              <Card>
                <CardContent className="p-10 text-sm text-slate-500">
                  Select a manager.
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function ManagerQueue({
  manager,
  queue,
}: {
  manager: ManagerSummary;
  queue: Awaited<ReturnType<typeof getQueueForManager>>;
}) {
  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{manager.displayName}</CardTitle>
              <CardDescription>
                {manager.email} · {manager.reportCount} direct report
                {manager.reportCount === 1 ? "" : "s"}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {manager.overCapCount > 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {manager.overCapCount} over {Math.round(OVER_CAP_THRESHOLD * 100)}% cap
                </span>
              ) : null}
              {manager.idleCount > 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                  <UsersIcon className="h-3.5 w-3.5" />
                  {manager.idleCount} idle ≥ {IDLE_THRESHOLD_DAYS}d
                </span>
              ) : null}
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Direct reports — cap utilisation this month</CardTitle>
          <CardDescription>
            % of per-product monthly cap consumed; green &lt;{" "}
            {Math.round(OVER_CAP_THRESHOLD * 100)}%, amber{" "}
            {Math.round(OVER_CAP_THRESHOLD * 100)}–100%, red ≥ 100%. Dash means
            no licence (or seat-priced — Copilot).
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <THead>
              <TR>
                <TH className="px-5">Report</TH>
                {PRODUCTS.map(({ key, label }) => (
                  <TH key={key} className="text-center">{label}</TH>
                ))}
                <TH className="text-right">MTD spend</TH>
                <TH className="text-right pr-5">Idle</TH>
              </TR>
            </THead>
            <TBody>
              {queue.map((r) => (
                <TR key={r.userId}>
                  <TD className="pl-5">
                    <Link
                      className="font-medium text-slate-900 hover:underline"
                      href={`/users?user=${r.userId}`}
                    >
                      {r.displayName}
                    </Link>
                    <div className="text-xs text-slate-500">{r.email}</div>
                  </TD>
                  {PRODUCTS.map(({ key }) => (
                    <TD key={key} className="text-center">
                      {capUtilBadge(r.capUtilisation[key as ProductKey])}
                    </TD>
                  ))}
                  <TD className="text-right font-mono">
                    {formatUsd(r.mtdSpendUsd, { decimals: 2 })}
                  </TD>
                  <TD className="text-right pr-5">{idleBadge(r.idleDays)}</TD>
                </TR>
              ))}
              {queue.length === 0 ? (
                <TR>
                  <TD className="px-5 py-6 text-sm text-slate-500" colSpan={PRODUCTS.length + 3}>
                    This manager has no direct reports.
                  </TD>
                </TR>
              ) : null}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent decisions affecting this manager&apos;s reports</CardTitle>
          <CardDescription>
            Reclamations, exception grants, and tier demotions from the program
            decision log (F5). v0.2 will replace this with{" "}
            <code className="font-mono">ReclamationEvent</code> /{" "}
            <code className="font-mono">ExceptionRequest</code> rows once those
            models land.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <THead>
              <TR>
                <TH className="px-5">When</TH>
                <TH>Type</TH>
                <TH>Subject</TH>
                <TH className="pr-5">Justification</TH>
              </TR>
            </THead>
            <TBody>
              {queue.flatMap((r) =>
                r.recentDecisions.map((d, i) => (
                  <TR key={`${r.userId}-${i}`}>
                    <TD className="pl-5 text-slate-600 font-mono text-xs">
                      {d.ts.toISOString().slice(0, 10)}
                    </TD>
                    <TD>
                      <Badge
                        variant={
                          d.type === "RECLAMATION"
                            ? "danger"
                            : d.type === "TIER_DEMOTION"
                              ? "warning"
                              : "secondary"
                        }
                      >
                        {d.type}
                      </Badge>
                    </TD>
                    <TD className="text-slate-700">{r.displayName}</TD>
                    <TD className="pr-5 text-slate-600 text-xs">{d.justification}</TD>
                  </TR>
                )),
              )}
              {queue.every((r) => r.recentDecisions.length === 0) ? (
                <TR>
                  <TD className="px-5 py-6 text-sm text-slate-500" colSpan={4}>
                    No recent reclamation / exception / demotion decisions.
                  </TD>
                </TR>
              ) : null}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
