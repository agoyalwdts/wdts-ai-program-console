import { Topbar } from "@/components/dashboard/topbar";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ImportCursorUsagePanel } from "./import-cursor-usage-panel";
import { CursorAlertsTable } from "./cursor-alerts-table";
import { Bell } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CursorAlertsSettingsPage() {
  await requirePermission(PERMISSIONS.IMPORTS_CURSOR_USAGE);

  const alerts = await prisma.cursorUsagePrudenceAlert.findMany({
    orderBy: { rowOccurredAt: "desc" },
    take: 150,
    select: {
      id: true,
      rowOccurredAt: true,
      userEmail: true,
      model: true,
      maxMode: true,
      outputTokens: true,
      cacheRead: true,
      costUsd: true,
      ruleCode: true,
      title: true,
      rationale: true,
      acknowledgedAt: true,
    },
  });

  const initial = alerts.map((a) => ({
    id: a.id,
    rowOccurredAt: a.rowOccurredAt.toISOString(),
    userEmail: a.userEmail,
    model: a.model,
    maxMode: a.maxMode,
    outputTokens: a.outputTokens,
    cacheRead: a.cacheRead,
    costUsd: a.costUsd,
    ruleCode: a.ruleCode,
    title: a.title,
    rationale: a.rationale,
    acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
  }));

  return (
    <>
      <Topbar
        title="Cursor usage prudence"
        subtitle="CSV upload or Admin API sync — same heuristics for expensive model usage. FinOps review."
      />
      <div className="p-6 space-y-6 max-w-6xl">
        <Card className="border-amber-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-amber-600" />
              How this works
            </CardTitle>
            <CardDescription>
              You can upload the team-usage CSV from the Cursor admin console, or use{" "}
              <strong>Sync from API</strong> below (POST{" "}
              <code className="font-mono text-xs">/teams/filtered-usage-events</code>) when{" "}
              <code className="font-mono text-xs">INTEGRATION_CURSOR=real</code> and a Team
              Admin API key are set. The same rules flag Max mode + stacked premium models with
              high cache read vs output, or thinking-xhigh spend. For automation, schedule an
              HMAC-signed POST to{" "}
              <code className="font-mono text-xs">/api/cron/cursor-prudence</code>. Set{" "}
              <code className="font-mono text-xs">RESEND_API_KEY</code> and{" "}
              <code className="font-mono text-xs">CURSOR_ALERT_EMAIL_TO</code> to email FinOps
              when new alert rows are inserted.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Upload CSV</CardTitle>
            <CardDescription>
              Dry run previews rule hits without writing. Create alerts dedupes on a hash
              of event + rule so re-uploading the same file does not duplicate rows.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ImportCursorUsagePanel />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent alerts</CardTitle>
            <CardDescription>Latest 150 by event time. Acknowledge after review.</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <CursorAlertsTable initial={initial} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
