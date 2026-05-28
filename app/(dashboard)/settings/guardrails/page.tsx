import { Topbar } from "@/components/dashboard/topbar";
import { requirePermission, userHasPermission } from "@/lib/auth";
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
import { emailProvider, isEmailConfigured } from "@/lib/notify/send-email";
import { GuardrailsAlertsTable } from "./guardrails-alerts-table";

export const dynamic = "force-dynamic";

export default async function GuardrailsSettingsPage() {
  const user = await requirePermission(PERMISSIONS.GUARDRAILS_MONITOR);
  const canManageUsers = userHasPermission(user, PERMISSIONS.USERS_MANAGE);

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
        userEmailNotifiedAt: true,
      },
    }),
    getUsageMirrorSnapshot(prisma),
  ]);

  const emails = [
    ...new Set(
      alerts.map((a) => a.userEmail?.trim().toLowerCase()).filter((e): e is string => Boolean(e)),
    ),
  ];
  const usersByEmail = new Map(
    emails.length > 0
      ? (
          await prisma.user.findMany({
            where: { email: { in: emails } },
            select: { email: true, disabled: true, dashboardRoleId: true },
          })
        ).map((u) => [u.email.toLowerCase(), u] as const)
      : [],
  );

  const tableKey =
    alerts.length > 0
      ? `${alerts.length}:${alerts[0]!.id}:${alerts[0]!.occurredAt.toISOString()}`
      : "empty";

  const initial = alerts.map((a) => {
    const email = a.userEmail?.trim().toLowerCase() ?? null;
    const subject = email ? usersByEmail.get(email) : undefined;
    return {
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
      userEmailNotifiedAt: a.userEmailNotifiedAt?.toISOString() ?? null,
      subjectHasUserRow: Boolean(subject),
      subjectDisabled: subject ? subject.disabled : null,
      subjectCanReenable: subject
        ? Boolean(subject.dashboardRoleId) && subject.disabled
        : false,
    };
  });

  return (
    <>
      <Topbar
        title="Guardrails monitor"
        subtitle="Day-one model posture, complexity-aware advisor, and cloud-control alerts"
      />
      <div className="p-6 space-y-6 max-w-[90rem]">
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
              Hourly cron + manual run. Per-row actions: acknowledge, email user, block console
              sign-in (<code className="font-mono text-xs">users.manage</code>), or log a seat-removal
              Decision (no vendor API). <strong>Cursor</strong> uses Team Admin{" "}
              <code className="font-mono text-xs">filtered-usage-events</code> when{" "}
              <code className="font-mono text-xs">INTEGRATION_CURSOR=real</code>. Automated + manual
              email use <code className="font-mono text-xs">EMAIL_PROVIDER=graph</code> (Microsoft
              Graph sendMail) or <code className="font-mono text-xs">resend</code>; hourly cron does
              not require the dashboard to be open. <strong>Codex</strong> uses Enterprise
              Analytics per-user usage when{" "}
              <code className="font-mono text-xs">INTEGRATION_CODEX_ENTERPRISE_ANALYTICS=real</code>
              . Block console creates a mirror User row when needed (no vendor API).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 px-6 pb-4">
            <UsageMirrorStatusPanel snapshot={usageMirror} />
            <RunGuardrailMonitorButton />
          </CardContent>
          <CardContent className="px-0 pb-0 pt-0">
            <GuardrailsAlertsTable
              key={tableKey}
              initial={initial}
              canManageUsers={canManageUsers}
              coachingEmailConfigured={isEmailConfigured()}
              emailProvider={emailProvider()}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
