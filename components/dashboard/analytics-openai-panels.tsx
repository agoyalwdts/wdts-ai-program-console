import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import type { ChatgptAdoptionSummary } from "@/lib/analytics/chatgpt-user-adoption";
import type { UnifiedCreditsBreakdown } from "@/lib/analytics/unified-credits-breakdown";
import { openAiBillingPeriodBounds } from "@/lib/integrations/unified-credits/billing-period";
import { formatUsd } from "@/lib/utils";

function BreakdownTable({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; credits: number; usd: number }[];
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">No {title.toLowerCase()} rows in window.</p>;
  }
  return (
    <Table>
      <THead>
        <TR>
          <TH>{title}</TH>
          <TH className="text-right">Credits</TH>
          <TH className="text-right">Est. USD</TH>
        </TR>
      </THead>
      <TBody>
        {rows.slice(0, 12).map((r) => (
          <TR key={r.key}>
            <TD className="font-mono text-xs max-w-[220px] truncate">{r.key}</TD>
            <TD className="text-right tabular-nums">{r.credits.toLocaleString()}</TD>
            <TD className="text-right tabular-nums">{formatUsd(r.usd, { decimals: 2 })}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

export function AnalyticsOpenAiPanels({
  unifiedCredits,
  adoption,
  billingCycleNote,
}: {
  unifiedCredits: UnifiedCreditsBreakdown | null;
  adoption: ChatgptAdoptionSummary | null;
  billingCycleNote?: boolean;
}) {
  const billing = billingCycleNote ? openAiBillingPeriodBounds() : null;

  if (!unifiedCredits && !adoption) return null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 mb-1">OpenAI compliance analytics</h2>
        <p className="text-xs text-slate-500 max-w-3xl">
          Unified Credits COSTS and Workspace Analytics syncs — SKU/model breakdown and ChatGPT
          adoption signals. Calendar-day COSTS rows; billing-cycle view uses the 16th→15th OpenAI
          envelope when noted below.
        </p>
        {billing ? (
          <p className="text-xs text-slate-600 mt-2 border-l-2 border-violet-400 pl-2">
            Current OpenAI billing period:{" "}
            <span className="font-mono">
              {billing.startYmd} → {billing.endYmdInclusive}
            </span>
            . F1 &quot;Current billing cycle&quot; uses the same anchor.
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {unifiedCredits ? (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Unified Credits — by SKU</CardTitle>
                <CardDescription>
                  {unifiedCredits.snapshotDays} snapshot day(s) ·{" "}
                  {unifiedCredits.totalCredits.toLocaleString()} credits total
                </CardDescription>
              </CardHeader>
              <CardContent>
                <BreakdownTable title="SKU" rows={unifiedCredits.bySku} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Unified Credits — by model</CardTitle>
              </CardHeader>
              <CardContent>
                <BreakdownTable title="Model" rows={unifiedCredits.byModel} />
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Unified Credits — by surface / client</CardTitle>
              </CardHeader>
              <CardContent>
                <BreakdownTable title="Surface" rows={unifiedCredits.bySurface} />
              </CardContent>
            </Card>
          </>
        ) : null}

        {adoption ? (
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">ChatGPT adoption (Workspace Analytics)</CardTitle>
              <CardDescription>
                {adoption.users.length} users across {adoption.snapshotDays} synced day(s). Dormant =
                no activity in 14+ days.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid gap-3 sm:grid-cols-4 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Dormant users</dt>
                  <dd className="font-mono text-lg font-semibold">{adoption.dormantCount}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">GPT message share</dt>
                  <dd className="font-mono text-lg font-semibold">
                    {(adoption.gptShare * 100).toFixed(0)}%
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Project share</dt>
                  <dd className="font-mono text-lg font-semibold">
                    {(adoption.projectShare * 100).toFixed(0)}%
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Tool share</dt>
                  <dd className="font-mono text-lg font-semibold">
                    {(adoption.toolShare * 100).toFixed(0)}%
                  </dd>
                </div>
              </dl>
              <Table>
                <THead>
                  <TR>
                    <TH>User</TH>
                    <TH className="text-right">Credits</TH>
                    <TH className="text-right">Messages</TH>
                    <TH>Last active</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {adoption.users.slice(0, 15).map((u) => (
                    <TR key={u.email}>
                      <TD className="font-mono text-xs max-w-[180px] truncate">{u.email}</TD>
                      <TD className="text-right tabular-nums">{u.creditsUsed.toFixed(1)}</TD>
                      <TD className="text-right tabular-nums">{u.messages}</TD>
                      <TD className="font-mono text-xs">{u.lastDayActive ?? "—"}</TD>
                      <TD>{u.dormant ? "Dormant" : "Active"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
