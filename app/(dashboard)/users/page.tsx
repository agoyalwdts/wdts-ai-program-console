import Link from "next/link";
import { Topbar } from "@/components/dashboard/topbar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { formatUsd, initials } from "@/lib/utils";
import { PRODUCTS, type ProductKey } from "@/lib/program";
import { startOfOpenAiChatGptCodexBillingPeriod } from "@/lib/openai-billing-period";
import {
  getAzureADClient,
  getDeelClient,
  getGatewayClient,
} from "@/lib/integrations";
import type { DeelEmployee, UsageRecord } from "@/lib/integrations";
import { requireUser } from "@/lib/auth";
import { summarizeCursorLoginIpsForEmail } from "@/lib/integrations/cursor/audit-logs";
import { summarizeCodexClientsForEmail } from "@/lib/integrations/codex-enterprise-analytics/distinct-clients-by-email";
import { normCodexAnalyticsEmail } from "@/lib/integrations/codex-enterprise-analytics/aggregate-per-user-mtd";
import {
  buildCodexPostureByEmailFromPayload,
  buildCodexUsagePostureView,
  loadLatestCodexSessionsSnapshot,
  type CodexUserUsagePosture,
} from "@/lib/analytics/codex-usage-posture";
import { formatLocalYmd } from "@/lib/f1-period";
import { summarizeEntraAiSignInIpsForEmail } from "@/lib/integrations/azuread/sign-in-logs";
import { summarizeComplianceAuthLogIpsForEmail } from "@/lib/integrations/openai-compliance";
import {
  mergeUserMtdSpendFromVendors,
  projectUserEom,
  sumUserMtd,
  type UserMtdSpendSource,
} from "@/lib/users/merge-user-mtd-spend";
import { Search, ChevronRight, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const DIRECTORY_VENDOR_TIMEOUT_MS = 2500;
const DIRECTORY_IDENTITY_TIMEOUT_MS = 1800;
const FOOTPRINT_TIMEOUT_MS = 12_000;

type SP = { q?: string; user?: string; page?: string };

function matches(u: DeelEmployee, q: string) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    u.email.toLowerCase().includes(needle) ||
    u.displayName.toLowerCase().includes(needle) ||
    u.roleTag.toLowerCase().includes(needle)
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function listDirectoryFromPrisma(): Promise<DeelEmployee[]> {
  const users = await prisma.user.findMany({
    select: {
      email: true,
      displayName: true,
      roleTag: true,
      manager: { select: { email: true } },
      region: true,
      status: true,
    },
    orderBy: { displayName: "asc" },
  });
  return users.map((u) => ({
    email: u.email,
    displayName: u.displayName,
    roleTag: u.roleTag ?? "",
    managerEmail: u.manager?.email ?? null,
    region: u.region,
    status:
      u.status === "SUSPENDED" || u.status === "TERMINATED" ? u.status : "ACTIVE",
  }));
}

async function getDirectoryPage(q: string, page: number) {
  // Directory rows come from Deel `listEmployees()`; Azure AD is only used
  // to enrich display when the integration exposes it. Links and detail use
  // Prisma `User.id` (UUID) when a row exists for that email — never Entra
  // object ids, which are not primary keys in our schema.
  const [employees, identityAll] = await Promise.all([
    withTimeout(
      getDeelClient().listEmployees(),
      DIRECTORY_VENDOR_TIMEOUT_MS,
      "Deel directory",
    ).catch(async (err) => {
      console.error(
        "[users] Deel listEmployees failed/slow; falling back to Prisma user table",
        err,
      );
      return listDirectoryFromPrisma();
    }),
    withTimeout(
      getAzureADClient().listUsers(),
      DIRECTORY_IDENTITY_TIMEOUT_MS,
      "Azure AD listUsers",
    ).catch((err) => {
      console.error(
        "[users] Azure AD listUsers failed/slow; continuing with directory only",
        err,
      );
      return [];
    }),
  ]);
  const idByEmail = new Map(identityAll.map((u) => [u.email, u]));

  const matched = employees
    .filter((e) => matches(e, q))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  const total = matched.length;
  const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE) || 1);
  const currentPage = Math.min(safePage, pageCount);
  const start = (currentPage - 1) * PAGE_SIZE;
  const slice = matched.slice(start, start + PAGE_SIZE);

  const emails = slice.map((e) => e.email);
  const prismaRows =
    emails.length === 0
      ? []
      : await prisma.user.findMany({
          where: { email: { in: emails } },
          select: { id: true, email: true },
        });
  const prismaIdByEmail = new Map(prismaRows.map((u) => [u.email, u.id]));

  const rows = slice.map((e) => {
    const id = idByEmail.get(e.email);
    return {
      id: prismaIdByEmail.get(e.email) ?? e.email,
      email: e.email,
      displayName: id?.displayName?.trim() ? id.displayName : e.displayName,
      roleTag: e.roleTag,
      region: e.region,
      status: e.status,
    };
  });

  return {
    rows,
    total,
    page: currentPage,
    pageCount,
    showingFrom: total === 0 ? 0 : start + 1,
    showingTo: start + rows.length,
  };
}

async function getUserDetail(selection: string) {
  const now = new Date();
  const calendarMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const openAiPeriodStart = startOfOpenAiChatGptCodexBillingPeriod(now);

  // The local User table is the identity cache; in v0.2 reconcilers populate
  // it from Azure AD + Deel nightly. Reading from it here is fine — it's a
  // cache of the integration clients' data, scoped to a single user with
  // their licences pre-joined. See .cursor/rules/data-model.mdc.
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ id: selection }, { email: selection }],
    },
    include: {
      manager: { select: { displayName: true, email: true } },
      licenses: true,
    },
  });
  if (!user) return null;

  const gateway = getGatewayClient();
  const since = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); // 90 days
  const uid = user.id;
  const footprintLookbackDays = 30;
  const [openAiAggs, otherAggs, recent, deelEmp, cursorFootprint, entraFootprint, complianceFootprint]: [
    Awaited<ReturnType<typeof gateway.aggregateByUser>>,
    Awaited<ReturnType<typeof gateway.aggregateByUser>>,
    UsageRecord[],
    DeelEmployee | null,
    Awaited<ReturnType<typeof summarizeCursorLoginIpsForEmail>>,
    Awaited<ReturnType<typeof summarizeEntraAiSignInIpsForEmail>>,
    Awaited<ReturnType<typeof summarizeComplianceAuthLogIpsForEmail>>,
  ] = await Promise.all([
    gateway.aggregateByUser({ userIds: [uid], periodStart: openAiPeriodStart, periodEnd: now }),
    gateway.aggregateByUser({ userIds: [uid], periodStart: calendarMonthStart, periodEnd: now }),
    gateway.listUsageRecords({ userId: uid, since, limit: 25 }),
    withTimeout(
      getDeelClient().getEmployeeByEmail(user.email),
      DIRECTORY_VENDOR_TIMEOUT_MS,
      "Deel employee lookup",
    ).catch((err) => {
      console.error("[users] Deel getEmployeeByEmail failed/slow; continuing without Deel row", err);
      return null;
    }),
    safeFootprint(
      () =>
        summarizeCursorLoginIpsForEmail({
          email: user.email,
          lookbackDays: footprintLookbackDays,
        }),
      "Cursor footprint",
    ),
    safeFootprint(
      () =>
        summarizeEntraAiSignInIpsForEmail({
          email: user.email,
          lookbackDays: footprintLookbackDays,
        }),
      "Entra footprint",
    ),
    safeFootprint(
      () =>
        summarizeComplianceAuthLogIpsForEmail({
          email: user.email,
          lookbackDays: footprintLookbackDays,
        }),
      "Compliance footprint",
    ),
  ]);

  const mtdMap = new Map<ProductKey, { sum: number; count: number }>();
  for (const a of otherAggs) {
    if (a.product === "CHATGPT" || a.product === "CODEX") continue;
    const prev = mtdMap.get(a.product) ?? { sum: 0, count: 0 };
    mtdMap.set(a.product, {
      sum: prev.sum + a.totalUsd,
      count: prev.count + a.requestCount,
    });
  }
  for (const a of openAiAggs) {
    if (a.product !== "CHATGPT" && a.product !== "CODEX") continue;
    const prev = mtdMap.get(a.product) ?? { sum: 0, count: 0 };
    mtdMap.set(a.product, {
      sum: prev.sum + a.totalUsd,
      count: prev.count + a.requestCount,
    });
  }

  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const totalMtd = Array.from(mtdMap.values()).reduce((acc, v) => acc + v.sum, 0);
  const projectedEom = dayOfMonth > 0 ? (totalMtd / dayOfMonth) * daysInMonth : totalMtd;

  return {
    user,
    deelEmp,
    mtdMap,
    recent,
    totalMtd,
    projectedEom,
    cursorFootprint,
    entraFootprint,
    complianceFootprint,
    openAiPeriodStart,
    calendarMonthStart,
    spendSources: {} as Partial<Record<ProductKey, UserMtdSpendSource>>,
  };
}

function resolveCodexUsagePostureForEmail(args: {
  snapshot: Awaited<ReturnType<typeof loadLatestCodexSessionsSnapshot>>;
  email: string;
  clip: { start: string; end: string };
}): CodexUserUsagePosture | null {
  if (!args.snapshot) return null;
  const view = buildCodexUsagePostureView({
    payload: args.snapshot.payload,
    clip: args.clip,
    snapshotPeriodStart: args.snapshot.periodStart,
    snapshotPeriodEnd: args.snapshot.periodEnd,
  });
  if (!view) return null;
  const norm = normCodexAnalyticsEmail(args.email);
  return view.topUsers.find((u) => u.email === norm) ?? null;
}

async function safeFootprint<T extends { available: boolean; reason?: string }>(
  fn: () => Promise<T>,
  label: string,
  timeoutMs = FOOTPRINT_TIMEOUT_MS,
): Promise<T> {
  try {
    return await withTimeout(fn(), timeoutMs, label);
  } catch (e) {
    return {
      available: false,
      reason: e instanceof Error ? e.message : "Footprint lookup failed",
    } as T;
  }
}

/** Prefer synced snapshot posture over a live Analytics API fan-out (often >2.5s in prod). */
async function resolveCodexClientFootprint(args: {
  email: string;
  posture: CodexUserUsagePosture | null;
  now: Date;
}): Promise<Awaited<ReturnType<typeof summarizeCodexClientsForEmail>>> {
  if (args.posture && args.posture.credits_used > 0) {
    return {
      available: true,
      distinctClients: [],
      lookbackDays: 30,
      ipNote:
        "Per-user client_id values are not stored in CODEX_SESSIONS_JSON snapshots. Credits and model mix appear in Codex usage posture below. Live Analytics lookup is skipped here to keep the page responsive.",
    };
  }
  return safeFootprint(
    () =>
      summarizeCodexClientsForEmail({
        email: args.email,
        lookbackDays: 30,
        now: args.now,
      }),
    "Codex footprint",
  );
}

export default async function UsersPage(props: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await props.searchParams;
  const q = sp.q?.trim() || "";
  const pageNum = parseInt(sp.page ?? "1", 10);
  const directory = await getDirectoryPage(q, pageNum);
  // Avoid expensive per-user footprint fan-out on initial page open.
  // Detail loads after explicit user selection.
  const selectedId = sp.user;
  const now = new Date();
  const codexClip = {
    start: formatLocalYmd(startOfOpenAiChatGptCodexBillingPeriod(now)),
    end: formatLocalYmd(now),
  };
  const [detail, codexSnapshot] = await Promise.all([
    selectedId ? getUserDetail(selectedId) : Promise.resolve(null),
    loadLatestCodexSessionsSnapshot(prisma),
  ]);
  const codexPostureByEmail = codexSnapshot
    ? buildCodexPostureByEmailFromPayload(codexSnapshot.payload)
    : new Map<string, CodexUserUsagePosture>();
  const detailCodexPosture =
    detail && codexSnapshot
      ? resolveCodexUsagePostureForEmail({
          snapshot: codexSnapshot,
          email: detail.user.email,
          clip: codexClip,
        })
      : null;

  let enrichedDetail = detail;
  let codexFootprint: Awaited<ReturnType<typeof summarizeCodexClientsForEmail>> | null = null;
  if (detail) {
    const [spendSources, resolvedCodexFootprint] = await Promise.all([
      mergeUserMtdSpendFromVendors({
        prisma,
        userEmail: detail.user.email,
        mtdMap: detail.mtdMap,
        calendarMonthStart: detail.calendarMonthStart,
        openAiPeriodStart: detail.openAiPeriodStart,
        periodEnd: now,
        codexCredits: detailCodexPosture?.credits_used,
      }),
      resolveCodexClientFootprint({
        email: detail.user.email,
        posture: detailCodexPosture,
        now,
      }),
    ]);
    codexFootprint = resolvedCodexFootprint;
    const totalMtd = sumUserMtd(detail.mtdMap);
    enrichedDetail = {
      ...detail,
      spendSources,
      totalMtd,
      projectedEom: projectUserEom(totalMtd, now),
    };
  }

  return (
    <>
      <Topbar
        title="Users"
        subtitle="F2 — search any user; see their full posture across the 5 products."
      />
      <div className="p-6 space-y-6">
        <Card>
          <CardContent className="p-4">
            <form className="flex items-center gap-3" action="/users">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  type="search"
                  name="q"
                  defaultValue={q}
                  placeholder="Search by name, email, or role tag (e.g. tech_writer)…"
                  className="pl-9"
                />
              </div>

              <Button type="submit">Search</Button>
            </form>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Result list */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>Results</CardTitle>
              <CardDescription>
                {directory.total === 0 ? (
                  <>No users matching </>
                ) : (
                  <>
                    Showing {directory.showingFrom}–{directory.showingTo} of {directory.total}{" "}
                    user{directory.total === 1 ? "" : "s"} matching{" "}
                  </>
                )}
                <code className="font-mono text-slate-700">{q || "all"}</code>
                {directory.pageCount > 1 ? (
                  <>
                    {" "}
                    (page {directory.page} of {directory.pageCount})
                  </>
                ) : null}
                . Directory:{" "}
                <code className="font-mono text-slate-700">
                  getDeelClient().listEmployees()
                </code>
                ; detail loads from Prisma <code className="font-mono">User</code> by id/email.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <ul className="divide-y divide-slate-100 max-h-[680px] overflow-y-auto">
                {directory.rows.map((u) => {
                  const isActive = u.id === selectedId;
                  const codexHint = codexPostureByEmail.get(normCodexAnalyticsEmail(u.email));
                  return (
                    <li key={`${u.email}:${u.id}`}>
                      <Link
                        href={`/users?q=${encodeURIComponent(q)}&page=${directory.page}&user=${encodeURIComponent(u.id)}`}
                        className={
                          "flex items-center gap-3 px-5 py-3 text-sm hover:bg-slate-50 transition-colors " +
                          (isActive ? "bg-slate-100" : "")
                        }
                      >
                        <div className="h-8 w-8 rounded-full bg-slate-200 text-slate-700 text-xs font-semibold inline-flex items-center justify-center">
                          {initials(u.displayName)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-slate-900 truncate">
                            {u.displayName}
                          </div>
                          <div className="text-xs text-slate-500 truncate">{u.email}</div>
                          {codexHint?.top_model ? (
                            <div className="text-[10px] text-slate-400 truncate mt-0.5">
                              Codex: {codexHint.top_model}
                              {codexHint.lines_added > 0
                                ? ` · ${codexHint.lines_added.toLocaleString()} lines`
                                : ""}
                            </div>
                          ) : null}
                        </div>
                        {u.region === "apac-mo" ? (
                          <Badge variant="warning">apac-mo</Badge>
                        ) : null}
                        <ChevronRight className="h-4 w-4 text-slate-300" />
                      </Link>
                    </li>
                  );
                })}
                {directory.rows.length === 0 ? (
                  <li className="p-5 text-sm text-slate-500">No users matched.</li>
                ) : null}
              </ul>
              {directory.pageCount > 1 ? (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3 text-xs text-slate-600">
                  <span>
                    Page {directory.page} of {directory.pageCount}
                  </span>
                  <div className="flex gap-3">
                    {directory.page > 1 ? (
                      <Link
                        href={`/users?q=${encodeURIComponent(q)}&page=${directory.page - 1}${selectedId ? `&user=${encodeURIComponent(selectedId)}` : ""}`}
                        className="font-medium text-sky-700 hover:underline"
                      >
                        Previous
                      </Link>
                    ) : (
                      <span className="text-slate-300">Previous</span>
                    )}
                    {directory.page < directory.pageCount ? (
                      <Link
                        href={`/users?q=${encodeURIComponent(q)}&page=${directory.page + 1}`}
                        className="font-medium text-sky-700 hover:underline"
                      >
                        Next
                      </Link>
                    ) : (
                      <span className="text-slate-300">Next</span>
                    )}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Detail */}
          <div className="lg:col-span-2 space-y-4">
            {enrichedDetail ? (
              <UserDetail
                detail={enrichedDetail}
                codexFootprint={codexFootprint}
                codexUsagePosture={detailCodexPosture}
                codexSnapshotMeta={
                  codexSnapshot
                    ? {
                        periodStart: codexSnapshot.periodStart,
                        periodEnd: codexSnapshot.periodEnd,
                      }
                    : null
                }
              />
            ) : selectedId ? (
              <Card>
                <CardContent className="p-10 text-sm text-slate-500">
                  No dashboard profile for this person yet — there is no matching{" "}
                  <code className="font-mono text-slate-700">User</code> row (by Prisma id or
                  email). They may need an Azure AD reconciler pass or roster import.
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-10 text-sm text-slate-500">
                  Select a user.
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function UserDetail({
  detail,
  codexFootprint,
  codexUsagePosture,
  codexSnapshotMeta,
}: {
  detail: NonNullable<Awaited<ReturnType<typeof getUserDetail>>>;
  codexFootprint: Awaited<ReturnType<typeof summarizeCodexClientsForEmail>> | null;
  codexUsagePosture: CodexUserUsagePosture | null;
  codexSnapshotMeta: { periodStart: string | null; periodEnd: string | null } | null;
}) {
  const {
    user,
    deelEmp,
    mtdMap,
    recent,
    totalMtd,
    projectedEom,
    cursorFootprint,
    entraFootprint,
    complianceFootprint,
    spendSources,
  } = detail;
  const licensesByProduct = new Map(user.licenses.map((l) => [l.product, l]));
  const isMacau = (deelEmp?.region ?? user.region) === "apac-mo";
  void deelEmp; // role tag already on user; deelEmp is a freshness check.

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{user.displayName}</CardTitle>
              <CardDescription>
                {user.email} · role <code className="font-mono">{user.roleTag}</code> ·{" "}
                region <code className="font-mono">{user.region}</code>
                {user.manager ? (
                  <> · reports to {user.manager.displayName}</>
                ) : (
                  <> · no manager (top-level / service account)</>
                )}
              </CardDescription>
            </div>
            <div className="text-right">
              <div className="text-2xl font-semibold text-slate-900">
                {formatUsd(totalMtd, { decimals: 2 })}
              </div>
              <div className="text-xs text-slate-500">
                MTD · projected EOM {formatUsd(projectedEom, { decimals: 0 })}
              </div>
              {Object.keys(spendSources).length > 0 ? (
                <p className="mt-1 text-[10px] text-slate-500 max-w-[14rem]">
                  Includes vendor-synced spend (Cursor / OpenAI analytics). Gateway mirror may
                  be stale — see tier table for sources.
                </p>
              ) : totalMtd === 0 ? (
                <p className="mt-1 text-[10px] text-amber-700 max-w-[14rem]">
                  Gateway mirror has no recent usage rows. Run vendor syncs or check Program
                  Health for live spend.
                </p>
              ) : null}
            </div>
          </div>
        </CardHeader>
        {isMacau ? (
          <CardContent>
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 inline-flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                Jurisdictional case (§3.3): this user is in <strong>apac-mo</strong>.
                OpenAI products (ChatGPT, Codex) are not available; expect{" "}
                <code className="font-mono">BLOCKED</code> decisions in usage records.
              </span>
            </div>
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sign-in footprint (30 days)</CardTitle>
          <CardDescription>
            Distinct IPs from Cursor Team Admin audit logs, Microsoft Entra sign-in logs (ChatGPT /
            Codex / OpenAI SSO), and OpenAI Compliance AUTH_LOG (ChatGPT Enterprise workspace).
            Codex Analytics shows client surfaces only — not IP addresses. Lookups may take up to
            12s; Entra requires <code className="font-mono text-xs">AuditLog.Read.All</code> on
            the prod app registration.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <div className="font-medium text-slate-900">Cursor</div>
            {cursorFootprint.available ? (
              <div className="mt-1 text-slate-700">
                <span className="font-mono text-base font-semibold">
                  {cursorFootprint.distinctIps.length}
                </span>{" "}
                distinct IP{cursorFootprint.distinctIps.length === 1 ? "" : "s"} from{" "}
                {cursorFootprint.loginEventCount} login event
                {cursorFootprint.loginEventCount === 1 ? "" : "s"} (Team Admin audit logs).
                {cursorFootprint.distinctIps.length > 0 ? (
                  <ul className="mt-2 list-disc pl-5 font-mono text-xs text-slate-600">
                    {cursorFootprint.distinctIps.map((ip) => (
                      <li key={ip}>{ip}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">No login IPs recorded in this window.</p>
                )}
              </div>
            ) : (
              <p className="mt-1 text-xs text-slate-500">{cursorFootprint.reason}</p>
            )}
          </div>
          <div>
            <div className="font-medium text-slate-900">Codex</div>
            {!codexFootprint ? (
              <p className="mt-1 text-xs text-slate-500">Loading Codex footprint…</p>
            ) : codexFootprint.available ? (
              <div className="mt-1 text-slate-700">
                <span className="font-mono text-base font-semibold">
                  {codexFootprint.distinctClients.length}
                </span>{" "}
                distinct client surface
                {codexFootprint.distinctClients.length === 1 ? "" : "s"} (not IP addresses).
                {codexFootprint.distinctClients.length > 0 ? (
                  <ul className="mt-2 list-disc pl-5 font-mono text-xs text-slate-600">
                    {codexFootprint.distinctClients.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">No Codex client activity in this window.</p>
                )}
                <p className="mt-2 text-xs text-slate-500">{codexFootprint.ipNote}</p>
              </div>
            ) : (
              <p className="mt-1 text-xs text-slate-500">{codexFootprint.reason}</p>
            )}
          </div>
          <div>
            <div className="font-medium text-slate-900">Entra SSO (ChatGPT / Codex / OpenAI)</div>
            {entraFootprint.available ? (
              <div className="mt-1 text-slate-700">
                <span className="font-mono text-base font-semibold">
                  {entraFootprint.distinctIps.length}
                </span>{" "}
                distinct IP{entraFootprint.distinctIps.length === 1 ? "" : "s"} from{" "}
                {entraFootprint.signInCount} matched sign-in
                {entraFootprint.signInCount === 1 ? "" : "s"} (Graph auditLogs/signIns).
                {entraFootprint.matchedApps.length > 0 ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Apps: {entraFootprint.matchedApps.join(", ")}
                  </p>
                ) : null}
                {entraFootprint.distinctIps.length > 0 ? (
                  <ul className="mt-2 list-disc pl-5 font-mono text-xs text-slate-600">
                    {entraFootprint.distinctIps.map((ip) => (
                      <li key={ip}>{ip}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">
                    No ChatGPT/Codex/OpenAI SSO sign-ins in this window.
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-1 text-xs text-slate-500">{entraFootprint.reason}</p>
            )}
          </div>
          <div>
            <div className="font-medium text-slate-900">ChatGPT (Compliance AUTH_LOG)</div>
            {complianceFootprint.available ? (
              <div className="mt-1 text-slate-700">
                <span className="font-mono text-base font-semibold">
                  {complianceFootprint.distinctIps.length}
                </span>{" "}
                distinct IP{complianceFootprint.distinctIps.length === 1 ? "" : "s"} from{" "}
                {complianceFootprint.authEventCount} auth event
                {complianceFootprint.authEventCount === 1 ? "" : "s"} (
                {complianceFootprint.logFilesScanned} log file
                {complianceFootprint.logFilesScanned === 1 ? "" : "s"} scanned).
                {complianceFootprint.distinctClients.length > 0 ? (
                  <p className="mt-2 text-xs text-slate-500">
                    Clients: {complianceFootprint.distinctClients.join(", ")}
                  </p>
                ) : null}
                {complianceFootprint.distinctDevices.length > 0 ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Devices: {complianceFootprint.distinctDevices.join(", ")}
                  </p>
                ) : null}
                {complianceFootprint.distinctUserAgents.length > 0 ? (
                  <details className="mt-2 text-xs text-slate-500">
                    <summary className="cursor-pointer">User agents ({complianceFootprint.distinctUserAgents.length})</summary>
                    <ul className="mt-1 list-disc pl-5 font-mono text-[10px] text-slate-600 max-h-32 overflow-auto">
                      {complianceFootprint.distinctUserAgents.map((ua) => (
                        <li key={ua}>{ua}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {complianceFootprint.distinctIps.length > 0 ? (
                  <ul className="mt-2 list-disc pl-5 font-mono text-xs text-slate-600">
                    {complianceFootprint.distinctIps.map((ip) => (
                      <li key={ip}>{ip}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">
                    No AUTH_LOG events for this user in scanned files.
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-1 text-xs text-slate-500">{complianceFootprint.reason}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card id="codex-usage">
        <CardHeader>
          <CardTitle>Codex usage posture</CardTitle>
          <CardDescription>
            Model mix and code attribution from the latest{" "}
            <code className="font-mono text-xs">CODEX_SESSIONS_JSON</code> snapshot (OpenAI billing
            period MTD).{" "}
            <Link href="/analytics/codex" className="text-sky-700 underline underline-offset-2">
              Program analytics
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {codexUsagePosture ? (
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-slate-500">Credits (snapshot window)</dt>
                <dd className="font-mono text-base font-semibold text-slate-900">
                  {codexUsagePosture.credits_used.toFixed(2)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Top model</dt>
                <dd className="font-mono text-base font-semibold text-slate-900">
                  {codexUsagePosture.top_model ?? "—"}
                  {codexUsagePosture.top_model ? (
                    <span className="text-sm font-normal text-slate-500">
                      {" "}
                      ({codexUsagePosture.top_model_credits.toFixed(1)} credits)
                    </span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Lines added</dt>
                <dd className="font-mono text-base font-semibold text-slate-900">
                  {codexUsagePosture.lines_added.toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Lines removed</dt>
                <dd className="font-mono text-base font-semibold text-slate-900">
                  {codexUsagePosture.lines_removed.toLocaleString()}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-slate-500 text-sm">
              No Codex usage posture in the current billing-period window. Run the Codex Enterprise
              Analytics sync or check{" "}
              <Link href="/analytics/codex" className="text-sky-700 underline underline-offset-2">
                Analytics → Codex posture
              </Link>
              .
            </p>
          )}
          {codexSnapshotMeta?.periodStart && codexSnapshotMeta.periodEnd ? (
            <p className="mt-3 text-xs text-slate-500">
              Snapshot covers {codexSnapshotMeta.periodStart} → {codexSnapshotMeta.periodEnd}.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tier &amp; spend per product</CardTitle>
          <CardDescription>
            One row per product; tiers from §4.6. MTD merges gateway mirror with vendor-synced
            Cursor spend and OpenAI analytics where available.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <THead>
              <TR>
                <TH className="px-5">Product</TH>
                <TH>Sub-tier</TH>
                <TH>Cap / month</TH>
                <TH>MTD spend</TH>
                <TH>Requests</TH>
                <TH>Flag</TH>
              </TR>
            </THead>
            <TBody>
              {PRODUCTS.map(({ key, label }) => {
                const lic = licensesByProduct.get(key as ProductKey);
                const usage = mtdMap.get(key as ProductKey) ?? { sum: 0, count: 0 };
                return (
                  <TR key={key}>
                    <TD className="pl-5 font-medium text-slate-900">{label}</TD>
                    <TD>
                      {lic ? (
                        <code className="font-mono text-xs">{lic.subTier}</code>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </TD>
                    <TD>
                      {lic?.capUsdMonth != null
                        ? formatUsd(lic.capUsdMonth)
                        : lic
                          ? "seat-priced"
                          : "—"}
                    </TD>
                    <TD className="font-mono">
                      {formatUsd(usage.sum, { decimals: 2 })}
                      {spendSources[key as ProductKey] === "vendor" ? (
                        <span className="ml-1 text-[10px] font-sans text-sky-700">vendor</span>
                      ) : null}
                    </TD>
                    <TD className="text-slate-600">{usage.count.toLocaleString()}</TD>
                    <TD>
                      {lic?.flag ? (
                        <Badge variant="warning">{lic.flag}</Badge>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent usage records</CardTitle>
          <CardDescription>
            Last 25 events from{" "}
            <code className="font-mono">getGatewayClient().listUsageRecords()</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <THead>
              <TR>
                <TH className="px-5">When</TH>
                <TH>Product</TH>
                <TH>Model</TH>
                <TH>Tokens</TH>
                <TH>Decision</TH>
                <TH className="text-right pr-5">Cost</TH>
              </TR>
            </THead>
            <TBody>
              {recent.map((r) => (
                <TR key={`${r.userId}-${r.ts.toISOString()}-${r.model}`}>
                  <TD className="pl-5 text-slate-600 font-mono text-xs">
                    {r.ts.toISOString().slice(0, 16).replace("T", " ")}
                  </TD>
                  <TD>
                    <Badge variant="outline">{r.product}</Badge>
                  </TD>
                  <TD className="text-slate-600 font-mono text-xs">{r.model}</TD>
                  <TD className="text-slate-600 text-xs">
                    {r.tokensIn?.toLocaleString() ?? "?"} →{" "}
                    {r.tokensOut?.toLocaleString() ?? "?"}
                  </TD>
                  <TD>
                    <Badge
                      variant={
                        r.decision === "BLOCKED"
                          ? "danger"
                          : r.decision === "PROMPTED"
                            ? "warning"
                            : "success"
                      }
                    >
                      {r.decision}
                    </Badge>
                  </TD>
                  <TD className="text-right pr-5 font-mono">
                    {formatUsd(r.costUsd ?? 0, { decimals: 4 })}
                  </TD>
                </TR>
              ))}
              {recent.length === 0 ? (
                <TR>
                  <TD className="px-5 py-6 text-sm text-slate-500" colSpan={6}>
                    No usage records.
                  </TD>
                </TR>
              ) : null}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
