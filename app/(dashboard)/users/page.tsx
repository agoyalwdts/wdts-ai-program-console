import Link from "next/link";
import { Topbar } from "@/components/dashboard/topbar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { formatUsd, initials } from "@/lib/utils";
import { PRODUCTS, type ProductKey } from "@/lib/program";
import { Search, ChevronRight, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

type SP = { q?: string; user?: string };

async function getUsers(q?: string) {
  return prisma.user.findMany({
    where: q
      ? {
          OR: [
            { email: { contains: q, mode: "insensitive" } },
            { displayName: { contains: q, mode: "insensitive" } },
            { roleTag: { contains: q, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: { displayName: "asc" },
    take: 50,
    select: {
      id: true,
      email: true,
      displayName: true,
      roleTag: true,
      region: true,
      status: true,
    },
  });
}

async function getSelectedUserDetail(userId: string) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      manager: { select: { displayName: true, email: true } },
      licenses: true,
    },
  });
  if (!user) return null;

  const mtd = await prisma.usageRecord.groupBy({
    by: ["product"],
    where: { userId, ts: { gte: startOfMonth } },
    _sum: { costUsd: true },
    _count: { _all: true },
  });
  const mtdMap = new Map<string, { sum: number; count: number }>(
    mtd.map((r) => [r.product, { sum: r._sum.costUsd ?? 0, count: r._count._all }]),
  );

  const recentUsage = await prisma.usageRecord.findMany({
    where: { userId },
    orderBy: { ts: "desc" },
    take: 25,
  });

  // Projected EOM: linearly extrapolate this month's days elapsed.
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const totalMtd = Array.from(mtdMap.values()).reduce((acc, v) => acc + v.sum, 0);
  const projectedEom = dayOfMonth > 0 ? (totalMtd / dayOfMonth) * daysInMonth : totalMtd;

  return { user, mtdMap, recentUsage, totalMtd, projectedEom };
}

export default async function UsersPage(props: { searchParams: Promise<SP> }) {
  const sp = await props.searchParams;
  const q = sp.q?.trim() || "";
  const users = await getUsers(q);
  const selectedId = sp.user || users[0]?.id;
  const detail = selectedId ? await getSelectedUserDetail(selectedId) : null;

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
              {selectedId ? (
                <input type="hidden" name="user" value={selectedId} />
              ) : null}
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
                {users.length} user{users.length === 1 ? "" : "s"} matching{" "}
                <code className="font-mono text-slate-700">{q || "all"}</code>
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <ul className="divide-y divide-slate-100 max-h-[680px] overflow-y-auto">
                {users.map((u) => {
                  const isActive = u.id === selectedId;
                  return (
                    <li key={u.id}>
                      <Link
                        href={`/users?q=${encodeURIComponent(q)}&user=${u.id}`}
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
                {users.length === 0 ? (
                  <li className="p-5 text-sm text-slate-500">No users matched.</li>
                ) : null}
              </ul>
            </CardContent>
          </Card>

          {/* Detail */}
          <div className="lg:col-span-2 space-y-4">
            {detail ? <UserDetail detail={detail} /> : (
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

function UserDetail({ detail }: { detail: NonNullable<Awaited<ReturnType<typeof getSelectedUserDetail>>> }) {
  const { user, mtdMap, recentUsage, totalMtd, projectedEom } = detail;
  const licensesByProduct = new Map(user.licenses.map((l) => [l.product, l]));
  const isMacau = user.region === "apac-mo";

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
          <CardDescription>One row per product; tiers from §4.6.</CardDescription>
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
                const usage = mtdMap.get(key) ?? { sum: 0, count: 0 };
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
          <CardDescription>Last 25 events.</CardDescription>
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
              {recentUsage.map((r) => (
                <TR key={r.id}>
                  <TD className="pl-5 text-slate-600 font-mono text-xs">
                    {r.ts.toISOString().slice(0, 16).replace("T", " ")}
                  </TD>
                  <TD>
                    <Badge variant="outline">{r.product}</Badge>
                  </TD>
                  <TD className="text-slate-600 font-mono text-xs">{r.model}</TD>
                  <TD className="text-slate-600 text-xs">
                    {r.tokensIn?.toLocaleString() ?? "?"} → {r.tokensOut?.toLocaleString() ?? "?"}
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
              {recentUsage.length === 0 ? (
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
