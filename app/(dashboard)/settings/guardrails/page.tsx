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
import {
  GUARDRAIL_PRODUCT_FILTER_ALL,
  guardrailProductFilterParam,
} from "@/lib/guardrails/alert-product-filter";
import {
  parseGuardrailListFilter,
  prismaWhereForGuardrailListFilter,
} from "@/lib/guardrails/alert-list-filter";
import {
  guardrailAlertSubjectLabel,
  guardrailAlertSubjectTitle,
} from "@/lib/guardrails/alert-subject-display";

export const dynamic = "force-dynamic";

type SP = { product?: string; severity?: string; ack?: string };

export default async function GuardrailsSettingsPage(props: { searchParams: Promise<SP> }) {
  const user = await requirePermission(PERMISSIONS.GUARDRAILS_MONITOR);
  const canManageUsers = userHasPermission(user, PERMISSIONS.USERS_MANAGE);

  const sp = await props.searchParams;
  const listFilter = parseGuardrailListFilter(sp);
  const alertWhere = prismaWhereForGuardrailListFilter(listFilter);
  const productFilterKey =
    guardrailProductFilterParam(listFilter.product) ?? GUARDRAIL_PRODUCT_FILTER_ALL;
  const severityFilterKey = listFilter.severity;
  const ackFilterKey = listFilter.ack;

  const [alerts, alertTotal, productGroups, usageMirror] = await Promise.all([
    prisma.guardrailPolicyAlert.findMany({
      where: alertWhere,
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
        context: true,
        dedupeKey: true,
      },
    }),
    prisma.guardrailPolicyAlert.count({ where: alertWhere }),
    prisma.guardrailPolicyAlert.groupBy({
      by: ["product"],
      _count: { _all: true },
    }),
    getUsageMirrorSnapshot(prisma),
  ]);

  const productCounts = productGroups
    .map((g) => ({
      value: g.product ?? "OTHER",
      count: g._count._all,
    }))
    .sort((a, b) => b.count - a.count);

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
      ? `${productFilterKey}:${severityFilterKey}:${ackFilterKey}:${alerts.length}:${alerts[0]!.id}:${alerts[0]!.occurredAt.toISOString()}`
      : `${productFilterKey}:${severityFilterKey}:${ackFilterKey}:empty`;

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
      subjectLabel: guardrailAlertSubjectLabel({
        userEmail: a.userEmail,
        ruleCode: a.ruleCode,
        context: a.context,
        dedupeKey: a.dedupeKey,
      }),
      subjectTitle: guardrailAlertSubjectTitle({
        userEmail: a.userEmail,
        ruleCode: a.ruleCode,
        context: a.context,
        dedupeKey: a.dedupeKey,
      }),
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
              model advisor, usage/credit signals (Codex Enterprise Analytics), and cloud-governance
              checks (allowlist/env-gating/high-risk approval evidence).
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
              ; user identity is resolved from org roster + Workspace Analytics snapshots (email
              when matched, otherwise <span className="font-mono text-xs">codex user …</span>).
              Block console requires a resolved email (no vendor API).
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
              productFilter={productFilterKey}
              severityFilter={severityFilterKey}
              ackFilter={ackFilterKey}
              productCounts={productCounts}
              alertTotal={alertTotal}
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
