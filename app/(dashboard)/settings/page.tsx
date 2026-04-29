import { Topbar } from "@/components/dashboard/topbar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePermission, getCurrentUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { formatUsd } from "@/lib/utils";
import {
  getAllIntegrationModes,
  getAzureOpenAIClient,
  realAzureADClient,
  type IntegrationName,
} from "@/lib/integrations";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  Crown,
  Database,
  KeyRound,
  ShieldCheck,
  Upload,
  Users,
} from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

type ProbeResult =
  | { ok: true; summary: string; detail?: React.ReactNode }
  | { ok: false; error: string };

async function probeAzureAD(): Promise<ProbeResult> {
  if (!process.env.AZURE_AD_TENANT_ID) {
    return { ok: false, error: "AZURE_AD_TENANT_ID not set in .env.local" };
  }
  try {
    const users = await realAzureADClient.listUsers();
    return {
      ok: true,
      summary: `${users.length} user${users.length === 1 ? "" : "s"} visible to the app registration`,
      detail: users.length > 0 ? (
        <div className="text-xs text-slate-500">
          First few:{" "}
          {users
            .slice(0, 3)
            .map((u) => u.displayName)
            .join(", ")}
          {users.length > 3 ? `, +${users.length - 3} more` : ""}
        </div>
      ) : undefined,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function probeAzureOpenAI(): Promise<ProbeResult> {
  if (!process.env.AZURE_OPENAI_ENDPOINT) {
    return { ok: false, error: "AZURE_OPENAI_ENDPOINT not set in .env.local" };
  }
  try {
    const deployments = await getAzureOpenAIClient().listDeployments();
    return {
      ok: true,
      summary: `${deployments.length} deployment${deployments.length === 1 ? "" : "s"}`,
      detail: deployments.length > 0 ? (
        <Table className="mt-2">
          <THead>
            <TR>
              <TH className="pl-3">Deployment</TH>
              <TH>Model</TH>
              <TH>Status</TH>
              <TH className="pr-3">Capacity</TH>
            </TR>
          </THead>
          <TBody>
            {deployments.map((d) => (
              <TR key={d.id}>
                <TD className="pl-3 font-mono text-xs">{d.id}</TD>
                <TD className="font-mono text-xs">{d.model}</TD>
                <TD>
                  <Badge variant={d.status === "succeeded" ? "success" : "warning"}>
                    {d.status}
                  </Badge>
                </TD>
                <TD className="pr-3 font-mono text-xs">
                  {d.capacity != null ? d.capacity.toLocaleString() : "—"}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : undefined,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const INTEGRATION_NOTES: Record<IntegrationName, string> = {
  gateway:
    "Phase 0 vendor decision pending (LiteLLM / Helicone / Portkey / Cloudflare AI Gateway / build).",
  cursor: "Cursor admin/SCIM token + workspace ID; v1.1 adds writes.",
  openai: "OpenAI Enterprise admin API key with users.read + usage.read scopes.",
  anthropic: "Anthropic admin API key (workspace-seat introspection beta).",
  m365graph: "Same app reg or a separate SP with Reports.Read.All + AuditLog.Read.All.",
  azuread:
    "Real client wired (PR #9). Default still synthetic until the v0.3 reconciler mirrors Graph users into the local User table.",
  deel: "Deel API token + webhook receiver URL. Now optional — CSV import covers the same need.",
  policyrepo: "GitHub PAT or App credentials; targets agoyalwdts/wdts-ai-policy.",
  azureopenai:
    "Resource API key from Azure Portal → Keys and Endpoint. Data plane only.",
};

export default async function SettingsPage() {
  // /settings exposes integration credentials health + admin tiles. The
  // permission-key gate is what enforces FINOPS/ADMIN; USER + MANAGER
  // are correctly redirected to / by `requirePermission`.
  await requirePermission(PERMISSIONS.DASHBOARD_VIEW_SETTINGS);

  const modes = getAllIntegrationModes();
  const [aadProbe, aoiProbe, currentUser] = await Promise.all([
    probeAzureAD(),
    probeAzureOpenAI(),
    getCurrentUser(),
  ]);

  const canManageUsers =
    currentUser?.permissions.includes(PERMISSIONS.USERS_MANAGE) ?? false;
  const canManageRoles =
    currentUser?.permissions.includes(PERMISSIONS.ROLES_MANAGE) ?? false;

  return (
    <>
      <Topbar
        title="Settings"
        subtitle="Connectivity + configuration. ADMIN/FINOPS only."
      />
      <div className="p-6 space-y-6 max-w-4xl">
        <Card>
          <CardHeader>
            <CardTitle>Your session</CardTitle>
            <CardDescription>
              How auth resolved your role for this session. The dashboard
              owns its own access control (LDR 0005); AAD provides identity
              only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SessionSummary user={currentUser} />
          </CardContent>
        </Card>

        {canManageUsers || canManageRoles ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {canManageUsers ? (
              <Card className="border-sky-200">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-sky-600" />
                    User management
                  </CardTitle>
                  <CardDescription>
                    Assign dashboard roles, enable/disable users.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Link
                    href="/settings/users"
                    className="inline-flex items-center gap-1 text-sm text-sky-700 hover:text-sky-900 underline-offset-4 hover:underline"
                  >
                    Open users console
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </CardContent>
              </Card>
            ) : null}
            {canManageRoles ? (
              <Card className="border-sky-200">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-sky-600" />
                    Roles & permissions
                  </CardTitle>
                  <CardDescription>
                    Built-ins + create custom roles.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Link
                    href="/settings/roles"
                    className="inline-flex items-center gap-1 text-sm text-sky-700 hover:text-sky-900 underline-offset-4 hover:underline"
                  >
                    Open roles console
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </CardContent>
              </Card>
            ) : null}
          </div>
        ) : null}

        <Card className="border-sky-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-4 w-4 text-sky-600" />
              Data imports
            </CardTitle>
            <CardDescription>
              Bulk-load employee data from a CSV. Use this when the Deel
              integration isn&apos;t live yet, or to seed a tenant from an
              HRIS export.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/settings/imports"
              className="inline-flex items-center gap-1 text-sm text-sky-700 hover:text-sky-900 underline-offset-4 hover:underline"
            >
              Open import console
              <ArrowRight className="h-4 w-4" />
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Live integration probes</CardTitle>
            <CardDescription>
              These call the <strong>real</strong> client regardless of the
              INTEGRATION_* mode flag, so a failed probe means your credentials
              are wrong (or admin consent is missing). Page-level reads still
              honour the flag.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ProbeRow
              icon={<KeyRound className="h-4 w-4" />}
              title="Microsoft Entra ID (Graph)"
              endpoint="graph.microsoft.com/v1.0/users"
              result={aadProbe}
            />
            <ProbeRow
              icon={<Database className="h-4 w-4" />}
              title="Azure OpenAI"
              endpoint={process.env.AZURE_OPENAI_ENDPOINT ?? "(not configured)"}
              result={aoiProbe}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Integration mode flags</CardTitle>
            <CardDescription>
              Each row maps an INTEGRATION_<code className="font-mono">*</code>{" "}
              env var to the client it selects. Flip in{" "}
              <code className="font-mono">.env.local</code>; restart the dev
              server to pick up changes.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <Table>
              <THead>
                <TR>
                  <TH className="pl-5">Integration</TH>
                  <TH>Mode</TH>
                  <TH className="pr-5">Notes</TH>
                </TR>
              </THead>
              <TBody>
                {(Object.keys(modes) as IntegrationName[]).map((name) => (
                  <TR key={name}>
                    <TD className="pl-5 font-mono text-sm">{name}</TD>
                    <TD>
                      <Badge variant={modes[name] === "real" ? "success" : "secondary"}>
                        {modes[name]}
                      </Badge>
                    </TD>
                    <TD className="pr-5 text-xs text-slate-600">
                      {INTEGRATION_NOTES[name]}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Program constants</CardTitle>
            <CardDescription>
              Hard-coded in <code className="font-mono">lib/program.ts</code>{" "}
              for v0.3; v0.4 moves the editable subset (alert thresholds,
              budgets) into the policy repo and wires a read-only display
              here.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-700">
            <Row
              k="ChatGPT + Codex monthly cap"
              v={formatUsd(150_000)}
              note="§4.6.2 combined operating cap"
            />
            <Row
              k="Cursor commitment"
              v={`${formatUsd(500_000)}/year`}
              note="$500K credit envelope · 120-seat plan, four sub-tiers; §4.6.1"
            />
            <Row
              k="Build"
              v="v0.3 (app-level RBAC)"
              note="See git log for the full PR chain."
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function ProbeRow({
  icon,
  title,
  endpoint,
  result,
}: {
  icon: React.ReactNode;
  title: string;
  endpoint: string;
  result: ProbeResult;
}) {
  return (
    <div className="rounded-md border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 text-slate-400">{icon}</div>
          <div>
            <div className="font-medium text-slate-900">{title}</div>
            <div className="text-xs text-slate-500 font-mono">{endpoint}</div>
          </div>
        </div>
        {result.ok ? (
          <Badge variant="success" className="flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            ok
          </Badge>
        ) : (
          <Badge variant="danger" className="flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            error
          </Badge>
        )}
      </div>
      <div className="mt-2 text-sm">
        {result.ok ? (
          <>
            <div className="text-slate-700">{result.summary}</div>
            {result.detail}
          </>
        ) : (
          <pre className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md p-2 whitespace-pre-wrap break-words">
            {result.error}
          </pre>
        )}
      </div>
    </div>
  );
}

function SessionSummary({
  user,
}: {
  user: Awaited<ReturnType<typeof getCurrentUser>>;
}) {
  if (!user) {
    return (
      <div className="text-sm text-slate-500">No session — anonymous request.</div>
    );
  }
  const src = user.roleSource;
  const sourceBadge =
    src.kind === "db" ? (
      <Badge variant="success" className="flex items-center gap-1">
        <CheckCircle2 className="h-3 w-3" />
        via DB role
      </Badge>
    ) : src.kind === "email-bootstrap" ? (
      <Badge variant="warning">via bootstrap email rule</Badge>
    ) : (
      <Badge variant="secondary">default (USER)</Badge>
    );

  return (
    <div className="rounded-md border border-slate-200 p-4 space-y-3">
      <div className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
        <div className="text-slate-500">Email</div>
        <div className="text-slate-900 font-mono text-xs">{user.email}</div>

        <div className="text-slate-500">Role</div>
        <div className="space-y-0.5">
          <Badge
            variant={
              user.role === "ADMIN"
                ? "success"
                : user.role === "FINOPS"
                  ? "warning"
                  : "secondary"
            }
          >
            {user.roleKey}
          </Badge>
          {user.roleKey !== user.role ? (
            <div className="text-xs text-slate-500">
              custom role; built-in equivalent for back-compat gates: {user.role}
            </div>
          ) : null}
        </div>

        <div className="text-slate-500">Source</div>
        <div className="space-y-1">
          {sourceBadge}
          {src.kind === "db" ? (
            <div className="text-xs font-mono text-slate-600 break-all">
              role row: {src.roleKey}
            </div>
          ) : src.kind === "email-bootstrap" ? (
            <div className="text-xs font-mono text-slate-600 break-all">
              pattern <code>/{src.pattern}/</code>
            </div>
          ) : null}
        </div>

        <div className="text-slate-500">Permissions</div>
        <div className="text-sm">
          <details>
            <summary className="cursor-pointer text-sky-700 hover:text-sky-900">
              {user.permissions.length} permission
              {user.permissions.length === 1 ? "" : "s"} granted (click to
              show)
            </summary>
            <ul className="mt-2 space-y-0.5 font-mono text-xs text-slate-700">
              {user.permissions.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </details>
        </div>

        {user.disabled ? (
          <>
            <div className="text-slate-500">Status</div>
            <div>
              <Badge variant="danger" className="flex items-center gap-1">
                <Crown className="h-3 w-3" />
                Disabled
              </Badge>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Row({ k, v, note }: { k: string; v: string; note?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
      <div className="min-w-40 text-sm font-medium text-slate-700">{k}</div>
      <div className="flex-1">
        <div className="text-sm font-mono text-slate-900">{v}</div>
        {note ? <div className="text-xs text-slate-500 mt-0.5">{note}</div> : null}
      </div>
      <CircleDashed className="h-3 w-3 text-slate-300 shrink-0 mt-1.5" />
    </div>
  );
}
