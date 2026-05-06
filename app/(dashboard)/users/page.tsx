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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { formatUsd, initials } from "@/lib/utils";
import { PRODUCTS, type ProductKey } from "@/lib/program";
import {
  getAzureADClient,
  getDeelClient,
  getGatewayClient,
} from "@/lib/integrations";
import type { DeelEmployee, UsageRecord } from "@/lib/integrations";
import { requireUser } from "@/lib/auth";
import { Search, ChevronRight, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type SP = { q?: string; user?: string; page?: string };

function matches(u: DeelEmployee, q: string) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    u.email.toLowerCase().includes(needle) ||
    u.displayName.toLowerCase().includes(needle) ||
    u.roleTag.toLowerCase().includes(needle)
  );
}

async function getDirectoryPage(q: string, page: number) {
  // Directory rows come from Deel `listEmployees()`; Azure AD is only used
  // to enrich display when the integration exposes it. Links and detail use
  // Prisma `User.id` (UUID) when a row exists for that email — never Entra
  // object ids, which are not primary keys in our schema.
  const [employees, identityAll] = await Promise.all([
    getDeelClient().listEmployees(),
    getAzureADClient().listUsers(),
  ]);
  const idByEmail = new Map(identityAll.map((u) => [u.email, u]));

  const matched = employees
    .filter((e) => matches(e, q))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  const total = matched.length;
  const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE) || 1);
  const currentPage = Math.min(safePage, pageCount);
  const start = (currentPage - 1) * PAGE_SIZE;
  const slice = matched.slice(start, start + PAGE_SIZE);

  const emails = slice.map((e) => e.email);
  const prismaRows =
    emails.length === 0
      ? []
      : await prisma.user.findMany({
          where: { email: { in: emails } },
          select: { id: true, email: true },
        });
  const prismaIdByEmail = new Map(prismaRows.map((u) => [u.email, u.id]));

  const rows = slice.map((e) => {
    const id = idByEmail.get(e.email);
    return {
      id: prismaIdByEmail.get(e.email) ?? e.email,
      email: e.email,
      displayName: id?.displayName?.trim() ? id.displayName : e.displayName,
      roleTag: e.roleTag,
      region: e.region,
      status: e.status,
    };
  });

  return {
    rows,
    total,
    page: currentPage,
    pageCount,
    showingFrom: total === 0 ? 0 : start + 1,
    showingTo: start + rows.length,
  };
}

async function getUserDetail(selection: string) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // The local User table is the identity cache; in v0.2 reconcilers populate
  // it from Azure AD + Deel nightly. Reading from it here is fine — it's a
  // cache of the integration clients' data, scoped to a single user with
  // their licences pre-joined. See .cursor/rules/data-model.mdc.
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ id: selection }, { email: selection }],
    },
    include: {
      manager: { select: { displayName: true, email: true } },
      licenses: true,
    },
  });
  if (!user) return null;

  const gateway = getGatewayClient();
  const since = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); // 90 days
  const uid = user.id;
  const [aggs, recent, deelEmp]: [
    Awaited<ReturnType<typeof gateway.aggregateByUser>>,
    UsageRecord[],
    DeelEmployee | null,
  ] = await Promise.all([
    gateway.aggregateByUser({ userIds: [uid], periodStart: startOfMonth, periodEnd: now }),
    gateway.listUsageRecords({ userId: uid, since, limit: 25 }),
    getDeelClient().getEmployeeByEmail(user.email),
  ]);

  const mtdMap = new Map<ProductKey, { sum: number; count: number }>();
  for (const a of aggs) {
    const prev = mtdMap.get(a.product) ?? { sum: 0, count: 0 };
    mtdMap.set(a.product, {
      sum: prev.sum + a.totalUsd,
      count: prev.count + a.requestCount,
    });
  }

  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const totalMtd = Array.from(mtdMap.values()).reduce((acc, v) => acc + v.sum, 0);
  const projectedEom = dayOfMonth > 0 ? (totalMtd / dayOfMonth) * daysInMonth : totalMtd;

  return { user, deelEmp, mtdMap, recent, totalMtd, projectedEom };
}

export default async function UsersPage(props: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await props.searchParams;
  const q = sp.q?.trim() || "";
  const pageNum = parseInt(sp.page ?? "1", 10);
  const directory = await getDirectoryPage(q, pageNum);
  const selectedId = sp.user || directory.rows[0]?.id;
  const detail = selectedId ? await getUserDetail(selectedId) : null;

  return (
    <>
      <Topbar
        title="Users"
        subtitle="F2 — search any user; see their full posture across the 5 products."
      />
      <div className="p-6 space-y-6">
        <Card>
          <CardContent className="p-4">
            <form className="flex items-center gap-3" action="/users">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  type="search"
                  name="q"
                  defaultValue={q}
                  placeholder="Search by name, email, or role tag (e.g. tech_writer)…"
                  className="pl-9"
                />
              </div>

              <Button type="submit">Search</Button>
            </form>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Result list */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>Results</CardTitle>
              <CardDescription>
                {directory.total === 0 ? (
                  <>No users matching </>
                ) : (
                  <>
                    Showing {directory.showingFrom}–{directory.showingTo} of {directory.total}{" "}
                    user{directory.total === 1 ? "" : "s"} matching{" "}
                  </>
                )}
                <code className="font-mono text-slate-700">{q || "all"}</code>
                {directory.pageCount > 1 ? (
                  <>
                    {" "}
                    (page {directory.page} of {directory.pageCount})
                  </>
                ) : null}
                . Directory:{" "}
                <code className="font-mono text-slate-700">
                  getDeelClient().listEmployees()
                </code>
                ; detail loads from Prisma <code className="font-mono">User</code> by id/email.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <ul className="divide-y divide-slate-100 max-h-[680px] overflow-y-auto">
                {directory.rows.map((u) => {
                  const isActive = u.id === selectedId;
                  return (
                    <li key={`${u.email}:${u.id}`}>
                      <Link
                        href={`/users?q=${encodeURIComponent(q)}&page=${directory.page}&user=${encodeURIComponent(u.id)}`}
                        className={
                          "flex items-center gap-3 px-5 py-3 text-sm hover:bg-slate-50 transition-colors " +
                          (isActive ? "bg-slate-100" : "")
                        }
                      >
                        <div className="h-8 w-8 rounded-full bg-slate-200 text-slate-700 text-xs font-semibold inline-flex items-center justify-center">
                          {initials(u.displayName)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-slate-900 truncate">
                            {u.displayName}
                          </div>
                          <div className="text-xs text-slate-500 truncate">{u.email}</div>
                        </div>
                        {u.region === "apac-mo" ? (
                          <Badge variant="warning">apac-mo</Badge>
                        ) : null}
                        <ChevronRight className="h-4 w-4 text-slate-300" />
                      </Link>
                    </li>
                  );
                })}
                {directory.rows.length === 0 ? (
                  <li className="p-5 text-sm text-slate-500">No users matched.</li>
                ) : null}
              </ul>
              {directory.pageCount > 1 ? (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3 text-xs text-slate-600">
                  <span>
                    Page {directory.page} of {directory.pageCount}
                  </span>
                  <div className="flex gap-3">
                    {directory.page > 1 ? (
                      <Link
                        href={`/users?q=${encodeURIComponent(q)}&page=${directory.page - 1}${selectedId ? `&user=${encodeURIComponent(selectedId)}` : ""}`}
                        className="font-medium text-sky-700 hover:underline"
                      >
                        Previous
                      </Link>
                    ) : (
                      <span className="text-slate-300">Previous</span>
                    )}
                    {directory.page < directory.pageCount ? (
                      <Link
                        href={`/users?q=${encodeURIComponent(q)}&page=${directory.page + 1}`}
                        className="font-medium text-sky-700 hover:underline"
                      >
                        Next
                      </Link>
                    ) : (
                      <span className="text-slate-300">Next</span>
                    )}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Detail */}
          <div className="lg:col-span-2 space-y-4">
            {detail ? (
              <UserDetail detail={detail} />
            ) : selectedId ? (
              <Card>
                <CardContent className="p-10 text-sm text-slate-500">
                  No dashboard profile for this person yet — there is no matching{" "}
                  <code className="font-mono text-slate-700">User</code> row (by Prisma id or
                  email). They may need an Azure AD reconciler pass or roster import.
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-10 text-sm text-slate-500">
                  Select a user.
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function UserDetail({
  detail,
}: {
  detail: NonNullable<Awaited<ReturnType<typeof getUserDetail>>>;
}) {
  const { user, deelEmp, mtdMap, recent, totalMtd, projectedEom } = detail;
  const licensesByProduct = new Map(user.licenses.map((l) => [l.product, l]));
  const isMacau = (deelEmp?.region ?? user.region) === "apac-mo";
  void deelEmp; // role tag already on user; deelEmp is a freshness check.

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{user.displayName}</CardTitle>
              <CardDescription>
                {user.email} · role <code className="font-mono">{user.roleTag}</code> ·{" "}
                region <code className="font-mono">{user.region}</code>
                {user.manager ? (
                  <> · reports to {user.manager.displayName}</>
                ) : (
                  <> · no manager (top-level / service account)</>
                )}
              </CardDescription>
            </div>
            <div className="text-right">
              <div className="text-2xl font-semibold text-slate-900">
                {formatUsd(totalMtd, { decimals: 2 })}
              </div>
              <div className="text-xs text-slate-500">
                MTD · projected EOM {formatUsd(projectedEom, { decimals: 0 })}
              </div>
            </div>
          </div>
        </CardHeader>
        {isMacau ? (
          <CardContent>
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 inline-flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                Jurisdictional case (§3.3): this user is in <strong>apac-mo</strong>.
                OpenAI products (ChatGPT, Codex) are not available; expect{" "}
                <code className="font-mono">BLOCKED</code> decisions in usage records.
              </span>
            </div>
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tier &amp; spend per product</CardTitle>
          <CardDescription>
            One row per product; tiers from §4.6. MTD aggregates via{" "}
            <code className="font-mono">getGatewayClient().aggregateByUser()</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <THead>
              <TR>
                <TH className="px-5">Product</TH>
                <TH>Sub-tier</TH>
                <TH>Cap / month</TH>
                <TH>MTD spend</TH>
                <TH>Requests</TH>
                <TH>Flag</TH>
              </TR>
            </THead>
            <TBody>
              {PRODUCTS.map(({ key, label }) => {
                const lic = licensesByProduct.get(key as ProductKey);
                const usage = mtdMap.get(key as ProductKey) ?? { sum: 0, count: 0 };
                return (
                  <TR key={key}>
                    <TD className="pl-5 font-medium text-slate-900">{label}</TD>
                    <TD>
                      {lic ? (
                        <code className="font-mono text-xs">{lic.subTier}</code>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </TD>
                    <TD>
                      {lic?.capUsdMonth != null
                        ? formatUsd(lic.capUsdMonth)
                        : lic
                          ? "seat-priced"
                          : "—"}
                    </TD>
                    <TD className="font-mono">{formatUsd(usage.sum, { decimals: 2 })}</TD>
                    <TD className="text-slate-600">{usage.count.toLocaleString()}</TD>
                    <TD>
                      {lic?.flag ? (
                        <Badge variant="warning">{lic.flag}</Badge>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent usage records</CardTitle>
          <CardDescription>
            Last 25 events from{" "}
            <code className="font-mono">getGatewayClient().listUsageRecords()</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <THead>
              <TR>
                <TH className="px-5">When</TH>
                <TH>Product</TH>
                <TH>Model</TH>
                <TH>Tokens</TH>
                <TH>Decision</TH>
                <TH className="text-right pr-5">Cost</TH>
              </TR>
            </THead>
            <TBody>
              {recent.map((r) => (
                <TR key={`${r.userId}-${r.ts.toISOString()}-${r.model}`}>
                  <TD className="pl-5 text-slate-600 font-mono text-xs">
                    {r.ts.toISOString().slice(0, 16).replace("T", " ")}
                  </TD>
                  <TD>
                    <Badge variant="outline">{r.product}</Badge>
                  </TD>
                  <TD className="text-slate-600 font-mono text-xs">{r.model}</TD>
                  <TD className="text-slate-600 text-xs">
                    {r.tokensIn?.toLocaleString() ?? "?"} →{" "}
                    {r.tokensOut?.toLocaleString() ?? "?"}
                  </TD>
                  <TD>
                    <Badge
                      variant={
                        r.decision === "BLOCKED"
                          ? "danger"
                          : r.decision === "PROMPTED"
                            ? "warning"
                            : "success"
                      }
                    >
                      {r.decision}
                    </Badge>
                  </TD>
                  <TD className="text-right pr-5 font-mono">
                    {formatUsd(r.costUsd ?? 0, { decimals: 4 })}
                  </TD>
                </TR>
              ))}
              {recent.length === 0 ? (
                <TR>
                  <TD className="px-5 py-6 text-sm text-slate-500" colSpan={6}>
                    No usage records.
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
