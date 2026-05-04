import { Topbar } from "@/components/dashboard/topbar";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getIntegrationMode } from "@/lib/integrations/env";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Activity, BookOpen, Radio } from "lucide-react";

export const dynamic = "force-dynamic";

function envNonEmpty(key: string): boolean {
  const v = process.env[key];
  return typeof v === "string" && v.trim().length > 0;
}

export default async function GatewayMirrorSettingsPage() {
  await requirePermission(PERMISSIONS.DASHBOARD_VIEW_SETTINGS);

  const [recentBatches, usageAgg] = await Promise.all([
    prisma.decision.findMany({
      where: { type: "USAGE_INGEST_BATCH" },
      orderBy: { ts: "desc" },
      take: 15,
      select: {
        id: true,
        ts: true,
        justification: true,
        afterState: true,
        beforeState: true,
      },
    }),
    prisma.usageRecord.aggregate({ _max: { ts: true } }),
  ]);

  const gatewayMode = getIntegrationMode("gateway");
  const lastEvent = usageAgg._max.ts;

  return (
    <>
      <Topbar
        title="Gateway usage mirror"
        subtitle="Webhook ingest health + recent batch audit rows."
      />
      <div className="p-6 space-y-6 max-w-4xl">
        <Card className="border-emerald-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-emerald-600" />
              Guidelines
            </CardTitle>
            <CardDescription>
              Operator runbook: HMAC generic ingest, LiteLLM Bearer callback, Cursor
              inference, env vars, and security notes.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-slate-700">
            Open <code className="font-mono text-xs">docs/gateway-and-litellm.md</code> in the
            repository clone (operator runbook).
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-slate-600" />
              Environment (set / unset only)
            </CardTitle>
            <CardDescription>
              Values are never shown. Configure secrets in Key Vault / GitHub Actions
              for deployed environments.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-2">
              <code className="font-mono text-xs text-slate-800">INTEGRATION_GATEWAY</code>
              <Badge variant={gatewayMode === "real" ? "success" : "secondary"}>
                {gatewayMode}
              </Badge>
            </div>
            <EnvRow k="USAGE_INGEST_HMAC_SECRET" ok={envNonEmpty("USAGE_INGEST_HMAC_SECRET")} />
            <EnvRow k="LITELLM_WEBHOOK_SECRET" ok={envNonEmpty("LITELLM_WEBHOOK_SECRET")} />
            <EnvRow k="CRON_SHARED_SECRET" ok={envNonEmpty("CRON_SHARED_SECRET")} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-slate-600" />
              Snapshot
            </CardTitle>
            <CardDescription>Latest usage event timestamp across all mirrored rows.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-slate-700">
            <div>
              <span className="text-slate-500">Latest UsageRecord.ts</span>{" "}
              <span className="font-mono">
                {lastEvent ? lastEvent.toISOString() : "— (no rows)"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent ingest batches</CardTitle>
            <CardDescription>
              <code className="font-mono text-xs">Decision.type = USAGE_INGEST_BATCH</code> — one
              row per webhook batch that actually upserted usage rows.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <Table>
              <THead>
                <TR>
                  <TH className="pl-4">When</TH>
                  <TH>Summary</TH>
                  <TH className="pr-4">After-state preview</TH>
                </TR>
              </THead>
              <TBody>
                {recentBatches.length === 0 ? (
                  <TR>
                    <TD colSpan={3} className="pl-4 pr-4 py-6 text-center text-slate-500 text-sm">
                      No batches yet. After LiteLLM or generic ingest succeeds, rows appear here.
                    </TD>
                  </TR>
                ) : (
                  recentBatches.map((d) => (
                    <TR key={d.id}>
                      <TD className="pl-4 text-xs whitespace-nowrap align-top">
                        {d.ts.toLocaleString()}
                      </TD>
                      <TD className="text-xs align-top max-w-[240px]">{d.justification}</TD>
                      <TD className="pr-4 text-xs font-mono align-top max-w-[280px] truncate" title={d.afterState}>
                        {d.afterState.slice(0, 120)}
                        {d.afterState.length > 120 ? "…" : ""}
                      </TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cron health check</CardTitle>
            <CardDescription>
              <code className="font-mono text-xs">POST /api/cron/usage-mirror-health</code> with
              HMAC (same as AzureAD reconciler). Returns 503 when the last{" "}
              <code className="font-mono text-xs">USAGE_INGEST_BATCH</code> is older than{" "}
              <code className="font-mono text-xs">maxStaleMinutes</code> (default 1440).
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </>
  );
}

function EnvRow({ k, ok }: { k: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-2 last:border-0">
      <code className="font-mono text-xs text-slate-800">{k}</code>
      <Badge variant={ok ? "success" : "secondary"}>{ok ? "set" : "unset"}</Badge>
    </div>
  );
}
