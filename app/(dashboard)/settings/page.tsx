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
import { requirePermission, getCurrentUser, userHasPermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { formatUsd } from "@/lib/utils";
import { OPENAI_COMBINED_MONTHLY_PLANNING_USD } from "@/lib/program";
import {
  fetchCodexEnterpriseWorkspaceUsageRows,
  getAllIntegrationModes,
  getAzureOpenAIClient,
  realAzureADClient,
  resolveCodexEnterpriseAnalyticsCredentials,
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
  Bell,
  Radio,
} from "lucide-react";
import Link from "next/link";
import { SyncCursorVendorSpendButton } from "@/components/dashboard/sync-cursor-vendor-spend-button";
import { SyncOpenAiVendorSpendButton } from "@/components/dashboard/sync-openai-vendor-spend-button";
import { SyncCodexEnterpriseSpendButton } from "@/components/dashboard/sync-codex-enterprise-spend-button";

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

async function probeCodexEnterpriseAnalytics(): Promise<ProbeResult> {
  const creds = resolveCodexEnterpriseAnalyticsCredentials(process.env);
  if (!creds) {
    return {
      ok: false,
      error:
        "OPENAI_CODEX_ANALYTICS_API_KEY and CHATGPT_WORKSPACE_ID (or OPENAI_CHATGPT_WORKSPACE_ID) not set",
    };
  }
  try {
    const end = Math.floor(Date.now() / 1000);
    const start = end - 7 * 86_400;
    const rows = await fetchCodexEnterpriseWorkspaceUsageRows({
      startTimeSec: start,
      endTimeSec: end,
      creds,
    });
    return {
      ok: true,
      summary: `${rows.length} workspace usage row(s) in the last 7d (UTC window)`,
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
    "Usage mirror + LiteLLM: docs/gateway-and-litellm.md; production ingest: docs/integrations/usage-ingest-production.md; GHA cron-usage-mirror-health.yml.",
  cursor:
    "SCIM: CURSOR_SCIM_BASE_URL + CURSOR_ADMIN_TOKEN. Team Admin usage API: same token or CURSOR_TEAM_ADMIN_API_KEY — Settings sync, POST /api/cron/sync-cursor-spend, or GHA cron-vendor-spend-sync.yml. Optional CURSOR_ANALYTICS_USERS_FILTER=comma,separated,emails scopes /analytics conversation-insights and /analytics/by-user/* on the Analytics page. Cloud Agents API (/v1/me, /v1/agents): set CURSOR_CLOUD_AGENTS_API_KEY (or CURSOR_INTEGRATIONS_API_KEY) from Dashboard → Integrations — Admin keys return 401 on /v1/*.",
  openai:
    "OpenAI Enterprise admin API key + org id. Vendor spend sync: POST /api/cron/sync-openai-spend or GHA cron-vendor-spend-sync.yml.",
  codexenterprise:
    "Bearer key (codex.enterprise.analytics.read) + CHATGPT_WORKSPACE_ID. GET api.chatgpt.com/v1/analytics/codex/… (usage, code_reviews, code_review_responses) — hourly snapshot sync + VendorDailySpend via POST /api/cron/sync-codex-enterprise-spend or GHA cron-vendor-spend-sync.yml.",
  openaicompliance:
    "Separate Compliance API key (OPENAI_COMPLIANCE_API_KEY) + CHATGPT_WORKSPACE_ID. AUTH_LOG JSONL at api.chatgpt.com/v1/compliance — security review before prod; F2 sign-in footprint.",
  anthropic: "Anthropic admin API key (workspace-seat introspection beta).",
  m365graph: "Same app reg or a separate SP with Reports.Read.All + AuditLog.Read.All.",
  azuread:
    "Real client wired (PR #9). Sign-in logs for ChatGPT/Codex SSO need AuditLog.Read.All on the app reg (F2 footprint). Default still synthetic until reconciler mirrors Graph users.",
  deel: "Deel API token + webhook receiver URL. Now optional — CSV import covers the same need.",
  policyrepo:
    "GitHub PAT or App credentials; targets agoyalwdts/wdts-ai-policy. Branch protection before PAT — see docs/integrations/production-blockers-checklist.md.",
  azureopenai:
    "Resource API key from Azure Portal → Keys and Endpoint. Data plane only.",
};

export default async function SettingsPage() {
  // /settings exposes integration credentials health + admin tiles. The
  // permission-key gate is what enforces FINOPS/ADMIN; USER + MANAGER
  // are correctly redirected to / by `requirePermission`.
  await requirePermission(PERMISSIONS.DASHBOARD_VIEW_SETTINGS);

  const modes = getAllIntegrationModes();
  const [aadProbe, aoiProbe, codexProbe, currentUser] = await Promise.all([
    probeAzureAD(),
    probeAzureOpenAI(),
    probeCodexEnterpriseAnalytics(),
    getCurrentUser(),
  ]);

  const canManageUsers =
    currentUser?.permissions.includes(PERMISSIONS.USERS_MANAGE) ?? false;
  const canManageRoles =
    currentUser?.permissions.includes(PERMISSIONS.ROLES_MANAGE) ?? false;
  const canCursorPrudence =
    currentUser != null &&
    userHasPermission(currentUser, PERMISSIONS.IMPORTS_CURSOR_USAGE);
  const canVendorSpendSync =
    currentUser != null &&
    userHasPermission(currentUser, PERMISSIONS.VENDOR_SPEND_SYNC);
  const canGuardrailsMonitor =
    currentUser != null &&
    userHasPermission(currentUser, PERMISSIONS.GUARDRAILS_MONITOR);

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

        {canCursorPrudence || canVendorSpendSync || canGuardrailsMonitor ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {canGuardrailsMonitor ? (
              <Card className="border-rose-200">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-rose-600" />
                    Day-one guardrails monitor
                  </CardTitle>
                  <CardDescription>
                    Active alerts for model defaults, complexity-aware nudges, and cloud controls
                    (allowlist, environment gating, step-up approvals).
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Link
                    href="/settings/guardrails"
                    className="inline-flex items-center gap-1 text-sm text-rose-800 underline-offset-4 hover:underline"
                  >
                    Open guardrails monitor
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </CardContent>
              </Card>
            ) : null}
            {canCursorPrudence ? (
              <Card className="border-amber-200">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Bell className="h-4 w-4 text-amber-600" />
                    Cursor usage prudence
                  </CardTitle>
                  <CardDescription>
                    Team-usage CSV heuristics (expensive models / Max mode vs tokens). Email
                    FinOps when configured.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Link
                    href="/settings/cursor-alerts"
                    className="inline-flex items-center gap-1 text-sm text-amber-800 underline-offset-4 hover:underline"
                  >
                    Open Cursor alerts
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </CardContent>
              </Card>
            ) : null}
            {canVendorSpendSync ? (
              <Card className="border-violet-200">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Radio className="h-4 w-4 text-violet-600" />
                    Cursor spend (Program Health)
                  </CardTitle>
                  <CardDescription>
                    Calls Cursor Team Admin{" "}
                    <code className="font-mono text-xs">/teams/filtered-usage-events</code>{" "}
                    (Basic auth). Upserts daily USD into the dashboard DB so the F1 CURSOR tile
                    matches the Cursor usage dashboard. Hourly cron refreshes the last 7 days;
                    use <strong>Backfill 90 days</strong> once to populate older F1 tiles (chunked
                    requests). Schedule{" "}
                    <code className="font-mono text-xs">POST /api/cron/sync-cursor-spend</code>{" "}
                    or run manually below.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <SyncCursorVendorSpendButton />
                </CardContent>
              </Card>
            ) : null}
            {canVendorSpendSync ? (
              <Card className="border-sky-200">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Radio className="h-4 w-4 text-sky-600" />
                    ChatGPT + Codex spend (Program Health)
                  </CardTitle>
                  <CardDescription>
                    Calls OpenAI{" "}
                    <code className="font-mono text-xs">GET /v1/organization/costs</code> with admin
                    key + org id. Buckets daily USD into <code className="font-mono text-xs">CHATGPT</code>{" "}
                    vs <code className="font-mono text-xs">CODEX</code> using line-item hints (and env
                    overrides). Schedule{" "}
                    <code className="font-mono text-xs">POST /api/cron/sync-openai-spend</code> or run
                    manually below.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <SyncOpenAiVendorSpendButton />
                </CardContent>
              </Card>
            ) : null}
            {canVendorSpendSync ? (
              <Card className="border-teal-200">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Radio className="h-4 w-4 text-teal-600" />
                    Codex spend (Enterprise Analytics)
                  </CardTitle>
                  <CardDescription>
                    Calls the{" "}
                    <code className="font-mono text-xs">api.chatgpt.com</code> Codex workspace usage
                    endpoint (see Codex Admin OpenAPI) with a Bearer key
                    (scoped <code className="font-mono text-xs">codex.enterprise.analytics.read</code>
                    ). Caches daily CODEX into <code className="font-mono text-xs">VendorDailySpend</code>{" "}
                    (F1 also calls the API live on each load when <code className="font-mono text-xs">INTEGRATION_CODEX_ENTERPRISE_ANALYTICS=real</code>
                    ). Optional <code className="font-mono text-xs">OPENAI_CODEX_ANALYTICS_USD_PER_CREDIT</code>{" "}
                    (default follows <code className="font-mono text-xs">OPENAI_CREDIT_OVERAGE_USD</code> in{" "}
                    <code className="font-mono text-xs">lib/program.ts</code>). Schedule{" "}
                    <code className="font-mono text-xs">POST /api/cron/sync-codex-enterprise-spend</code>{" "}
                    or run below.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <SyncCodexEnterpriseSpendButton />
                </CardContent>
              </Card>
            ) : null}
          </div>
        ) : null}

        <Card className="border-emerald-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-emerald-600" />
              Gateway usage mirror
            </CardTitle>
            <CardDescription>
              LiteLLM / generic webhook ingest health, recent batch decisions, env checklist.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/settings/gateway-mirror"
              className="inline-flex items-center gap-1 text-sm text-emerald-800 underline-offset-4 hover:underline"
            >
              Open gateway mirror
              <ArrowRight className="h-4 w-4" />
            </Link>
          </CardContent>
        </Card>

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
            <ProbeRow
              icon={<Radio className="h-4 w-4" />}
              title="Codex Enterprise Analytics"
              endpoint="api.chatgpt.com/v1/analytics/codex/…/usage|code_reviews|code_review_responses"
              result={codexProbe}
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
              k="ChatGPT + Codex monthly planning"
              v={formatUsd(OPENAI_COMBINED_MONTHLY_PLANNING_USD)}
              note="314 × $33/mo pool license + ~350k overage credits × $0.07 (lib/program.ts)"
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
