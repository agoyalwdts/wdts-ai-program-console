import { Topbar } from "@/components/dashboard/topbar";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Bell, ShieldCheck } from "lucide-react";
import {
  COMPLEXITY_ADVISOR_PSEUDO_RULE,
  DAY_ONE_DEFAULT_MODEL,
  DISABLED_MODE_MARKERS,
} from "@/lib/guardrails/day-one-defaults";
import { RunGuardrailMonitorButton } from "@/components/dashboard/run-guardrail-monitor-button";
import { UsageMirrorStatusPanel } from "@/components/dashboard/usage-mirror-status-panel";
import { getUsageMirrorSnapshot } from "@/lib/gateway-mirror/usage-mirror-snapshot";
import { GuardrailsAlertsTable } from "./guardrails-alerts-table";

export const dynamic = "force-dynamic";

export default async function GuardrailsSettingsPage() {
  await requirePermission(PERMISSIONS.GUARDRAILS_MONITOR);

  const [alerts, usageMirror] = await Promise.all([
    prisma.guardrailPolicyAlert.findMany({
    orderBy: { occurredAt: "desc" },
    take: 200,
    select: {
      id: true,
      occurredAt: true,
      category: true,
      severity: true,
      product: true,
      userEmail: true,
      model: true,
      ruleCode: true,
      title: true,
      rationale: true,
      recommendation: true,
      acknowledgedAt: true,
    },
  }),
    getUsageMirrorSnapshot(prisma),
  ]);

  const tableKey =
    alerts.length > 0
      ? `${alerts.length}:${alerts[0]!.id}:${alerts[0]!.occurredAt.toISOString()}`
      : "empty";

  const initial = alerts.map((a) => ({
    id: a.id,
    occurredAt: a.occurredAt.toISOString(),
    category: a.category,
    severity: a.severity,
    product: a.product,
    userEmail: a.userEmail,
    model: a.model,
    ruleCode: a.ruleCode,
    title: a.title,
    rationale: a.rationale,
    recommendation: a.recommendation,
    acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
  }));

  return (
    <>
      <Topbar
        title="Guardrails monitor"
        subtitle="Day-one model posture, complexity-aware advisor, and cloud-control alerts"
      />
      <div className="p-6 space-y-6 max-w-6xl">
        <Card className="border-amber-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-amber-600" />
              Day-one defaults
            </CardTitle>
            <CardDescription>
              Conservative default model posture (Codex/Cursor fast/yolo disabled), complexity-aware
              model advisor, and cloud-governance checks (allowlist/env-gating/high-risk approval evidence).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-700">
            <div>
              <div className="font-medium text-slate-900">Default model posture</div>
              <pre className="mt-1 rounded border border-slate-200 bg-slate-50 p-2 text-xs">{JSON.stringify(DAY_ONE_DEFAULT_MODEL, null, 2)}</pre>
            </div>
            <div>
              <div className="font-medium text-slate-900">Explicitly disabled mode markers</div>
              <pre className="mt-1 rounded border border-slate-200 bg-slate-50 p-2 text-xs">{JSON.stringify(DISABLED_MODE_MARKERS, null, 2)}</pre>
            </div>
            <div>
              <div className="font-medium text-slate-900">Complexity-aware advisor pseudo-rule</div>
              <pre className="mt-1 rounded border border-slate-200 bg-slate-50 p-2 text-xs whitespace-pre-wrap">{COMPLEXITY_ADVISOR_PSEUDO_RULE.trim()}</pre>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-sky-600" />
              Active alerts
            </CardTitle>
            <CardDescription>
              Hourly cron + manual run. <strong>Cursor</strong> is evaluated from Team Admin{" "}
              <code className="font-mono text-xs">filtered-usage-events</code> when{" "}
              <code className="font-mono text-xs">INTEGRATION_CURSOR=real</code>; other products need
              gateway mirror ingest. User coaching:{" "}
              <code className="font-mono text-xs">USER_MODEL_COACHING_EMAIL=1</code> +{" "}
              <code className="font-mono text-xs">RESEND_API_KEY</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 px-6 pb-4">
            <UsageMirrorStatusPanel snapshot={usageMirror} />
            <RunGuardrailMonitorButton />
          </CardContent>
          <CardContent className="px-0 pb-0 pt-0">
            <GuardrailsAlertsTable key={tableKey} initial={initial} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
