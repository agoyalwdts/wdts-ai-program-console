import { Topbar } from "@/components/dashboard/topbar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { BudgetBar } from "@/components/charts/budget-bar";
import { SpendTrendChart, type SpendPoint } from "@/components/charts/spend-trend-chart";
import { prisma } from "@/lib/prisma";
import {
  COMBINED_CHATGPT_CODEX_CAP_MONTH,
  MONTHLY_BUDGET_USD,
  PRODUCTS,
  type ProductKey,
} from "@/lib/program";
import { formatUsd } from "@/lib/utils";

export const dynamic = "force-dynamic";

async function getF1Data() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // MTD spend per product.
  const mtd = await prisma.usageRecord.groupBy({
    by: ["product"],
    where: { ts: { gte: startOfMonth }, decision: { in: ["ALLOWED", "PROMPTED"] } },
    _sum: { costUsd: true },
  });
  const mtdMap = new Map<string, number>(
    mtd.map((r) => [r.product, r._sum.costUsd ?? 0]),
  );

  // Daily spend trend across the past 30 days, per product.
  const usage = await prisma.usageRecord.findMany({
    where: { ts: { gte: thirtyDaysAgo } },
    select: { product: true, costUsd: true, ts: true },
  });

  const days: SpendPoint[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    days.push({
      day: `${d.getMonth() + 1}/${d.getDate()}`,
      CURSOR: 0,
      CHATGPT: 0,
      CODEX: 0,
      CLAUDE_AI: 0,
      M365_COPILOT: 0,
    });
  }
  const dayKey = (d: Date) =>
    `${d.getMonth() + 1}/${d.getDate()}`;
  const idxByDay = new Map(days.map((d, i) => [d.day, i]));
  for (const u of usage) {
    const k = dayKey(new Date(u.ts));
    const i = idxByDay.get(k);
    if (i == null) continue;
    const p = u.product as keyof SpendPoint;
    if (p === "day") continue;
    days[i]![p] = (days[i]![p] as number) + (u.costUsd ?? 0);
  }

  // Top 10 spenders MTD across all products.
  const topRaw = await prisma.usageRecord.groupBy({
    by: ["userId"],
    where: { ts: { gte: startOfMonth } },
    _sum: { costUsd: true },
    orderBy: { _sum: { costUsd: "desc" } },
    take: 10,
  });
  const userIds = topRaw.map((r) => r.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, displayName: true, email: true, roleTag: true, region: true },
  });
  const usersById = new Map(users.map((u) => [u.id, u]));
  const top = topRaw
    .map((r) => ({
      ...usersById.get(r.userId)!,
      total: r._sum.costUsd ?? 0,
    }))
    .filter((r) => r.id);

  return { mtdMap, days, top, combinedChatGptCodexMtd: (mtdMap.get("CHATGPT") ?? 0) + (mtdMap.get("CODEX") ?? 0) };
}

export default async function HealthPage() {
  const data = await getF1Data();

  return (
    <>
      <Topbar
        title="Program Health"
        subtitle="F1 — Are we on track vs the program-level budgets?"
      />
      <div className="p-6 space-y-6">
        {/* Combined cap callout */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>ChatGPT + Codex combined cap</CardTitle>
                <CardDescription>
                  $150,000/month operating cap (§4.6.2). Cap-overcommit at the user level
                  is intentional; the program never overruns this number.
                </CardDescription>
              </div>
              <div className="text-right">
                <div className="text-2xl font-semibold">
                  {formatUsd(data.combinedChatGptCodexMtd)}
                </div>
                <div className="text-xs text-slate-500">
                  of {formatUsd(COMBINED_CHATGPT_CODEX_CAP_MONTH)} MTD
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <BudgetBar
              spend={data.combinedChatGptCodexMtd}
              budget={COMBINED_CHATGPT_CODEX_CAP_MONTH}
              warnAt={0.9}
            />
          </CardContent>
        </Card>

        {/* Per-product cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {PRODUCTS.map(({ key, label }) => {
            const mtd = data.mtdMap.get(key) ?? 0;
            const budget = MONTHLY_BUDGET_USD[key as ProductKey];
            return (
              <Card key={key}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xs uppercase tracking-wider text-slate-500">
                      {label}
                    </CardTitle>
                    <Badge variant="outline">{key}</Badge>
                  </div>
                  <div className="text-2xl font-semibold text-slate-900 mt-1">
                    {formatUsd(mtd)}
                  </div>
                  <div className="text-xs text-slate-500">
                    of {formatUsd(budget)} monthly budget
                  </div>
                </CardHeader>
                <CardContent>
                  <BudgetBar spend={mtd} budget={budget} />
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Spend trend chart */}
        <Card>
          <CardHeader>
            <CardTitle>Daily spend, last 30 days</CardTitle>
            <CardDescription>
              Stacked across all 5 products. Synthetic data.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SpendTrendChart data={data.days} />
          </CardContent>
        </Card>

        {/* Top 10 spenders */}
        <Card>
          <CardHeader>
            <CardTitle>Top 10 spenders (MTD)</CardTitle>
            <CardDescription>Across all products combined.</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <Table>
              <THead>
                <TR>
                  <TH className="px-5">User</TH>
                  <TH>Email</TH>
                  <TH>Role tag</TH>
                  <TH>Region</TH>
                  <TH className="text-right pr-5">MTD spend</TH>
                </TR>
              </THead>
              <TBody>
                {data.top.map((u) => (
                  <TR key={u.id}>
                    <TD className="pl-5 font-medium text-slate-900">{u.displayName}</TD>
                    <TD className="text-slate-600">{u.email}</TD>
                    <TD>
                      <Badge variant="secondary">{u.roleTag}</Badge>
                    </TD>
                    <TD>
                      <Badge variant={u.region === "apac-mo" ? "warning" : "outline"}>
                        {u.region}
                      </Badge>
                    </TD>
                    <TD className="text-right pr-5 font-mono text-slate-900">
                      {formatUsd(u.total, { decimals: 2 })}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <p className="text-xs text-slate-400">
          v0.1 — synthetic data. F1 of Dashboard_Scoping_v1.md §2.
        </p>
      </div>
    </>
  );
}
