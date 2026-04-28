import { Topbar } from "@/components/dashboard/topbar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function SettingsPage() {
  return (
    <>
      <Topbar title="Settings" subtitle="Stub. Real settings deferred to v0.2." />
      <div className="p-6 space-y-6 max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>v0.1 prototype — settings are read-only</CardTitle>
            <CardDescription>
              The dashboard reads its configuration from <code className="font-mono">lib/program.ts</code>{" "}
              and <code className="font-mono">.env</code> for v0.1. Editable settings (program
              budgets, alert thresholds, notification routing, gateway endpoints) land in v0.2.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-700">
            <Row k="Auth" v="STUB (DEV)" badge="warning" note="See lib/auth.ts. Wire to Azure AD via NextAuth in v0.2." />
            <Row k="Database" v="Postgres 16 (Docker Compose)" badge="success" note="See docker-compose.yml" />
            <Row k="Gateway client" v="synthetic" badge="warning" note="Will swap to real Portkey/LiteLLM/Helicone client in v0.2" />
            <Row k="Decision log retention" v="13 months (planned)" badge="secondary" note="Append-only enforced by convention in v0.1" />
            <Row k="Build version" v="v0.1.0 prototype" badge="secondary" />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Row({ k, v, badge, note }: { k: string; v: string; badge: "success" | "warning" | "secondary"; note?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3 last:border-0 last:pb-0">
      <div className="min-w-32 text-sm font-medium text-slate-700">{k}</div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <code className="font-mono text-sm text-slate-900">{v}</code>
          <Badge variant={badge}>{badge}</Badge>
        </div>
        {note ? <div className="text-xs text-slate-500 mt-0.5">{note}</div> : null}
      </div>
    </div>
  );
}
