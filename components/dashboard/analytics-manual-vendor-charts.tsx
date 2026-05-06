"use client";

import Link from "next/link";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { ManualVendorSnapshotDTO } from "@/lib/analytics/manual-vendor-snapshots";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatUsd } from "@/lib/utils";

function findSnapshot(
  snapshots: ManualVendorSnapshotDTO[],
  kind: string,
): ManualVendorSnapshotDTO | undefined {
  return snapshots.find((s) => s.kind === kind);
}

function CodexWorkspaceChart({ payload }: { payload: unknown }) {
  const p = payload as { days?: { date: string; credits: number; users: number; turns: number }[] };
  const data = (p.days ?? []).map((d) => ({
    date: d.date.slice(5),
    credits: d.credits,
    users: d.users,
  }));
  if (data.length === 0) return <p className="text-sm text-slate-500">No series in payload.</p>;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip
            formatter={(v) => formatUsd(typeof v === "number" ? v : Number(v), { decimals: 2 })}
          />
          <Legend />
          <Line type="monotone" dataKey="credits" name="Credits (USD)" stroke="#0ea5e9" dot={false} />
          <Line type="monotone" dataKey="users" name="Users" stroke="#64748b" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function CodexSessionsChart({ payload }: { payload: unknown }) {
  const p = payload as { creditsByDate?: Record<string, number> };
  const data = Object.entries(p.creditsByDate ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, credits]) => ({ date: date.slice(5), credits }));
  if (data.length === 0) return <p className="text-sm text-slate-500">No aggregated days.</p>;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip
            formatter={(v) => formatUsd(typeof v === "number" ? v : Number(v), { decimals: 2 })}
          />
          <Bar dataKey="credits" name="Credits" fill="#0ea5e9" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CodexCodeReviewChart({ payload }: { payload: unknown }) {
  const p = payload as { days?: { date: string; n_reviews: number; n_comments: number }[] };
  const data = (p.days ?? []).map((d) => ({
    date: d.date.slice(5),
    reviews: d.n_reviews,
    comments: d.n_comments,
  }));
  if (data.length === 0) return <p className="text-sm text-slate-500">No rows.</p>;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="reviews" name="Reviews" stroke="#7c3aed" dot={false} />
          <Line type="monotone" dataKey="comments" name="Comments" stroke="#10b981" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function CursorTeamChart({ payload }: { payload: unknown }) {
  const p = payload as {
    dateColumn?: string;
    headers?: string[];
    rows?: Record<string, string>[];
  };
  const dateCol = p.dateColumn ?? "Date";
  const headers = p.headers ?? [];
  const dauCol =
    headers.find((h) => /active users daily active users/i.test(h)) ??
    headers.find((h) => /daily active users/i.test(h));
  const chatCol = headers.find((h) => /^chats chat$/i.test(h.trim()));
  const rows = p.rows ?? [];
  if (!dauCol && !chatCol) {
    return <p className="text-sm text-slate-500">Could not find DAU / Chats Chat columns.</p>;
  }
  const data = rows
    .map((r) => {
      const day = (r[dateCol] ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
      return {
        date: day.slice(5),
        dau: dauCol ? Number((r[dauCol] ?? "").replace(/,/g, "")) || 0 : 0,
        chats: chatCol ? Number((r[chatCol] ?? "").replace(/,/g, "")) || 0 : 0,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
  if (data.length === 0) return <p className="text-sm text-slate-500">No dated rows.</p>;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend />
          {dauCol ? (
            <Line type="monotone" dataKey="dau" name="DAU" stroke="#7c3aed" dot={false} />
          ) : null}
          {chatCol ? (
            <Line type="monotone" dataKey="chats" name="Chats" stroke="#10b981" dot={false} />
          ) : null}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChatgptUsersTable({ payload }: { payload: unknown }) {
  const p = payload as {
    users?: { email: string; name: string; credits_used: number; messages: number }[];
  };
  const users = [...(p.users ?? [])].sort((a, b) => b.credits_used - a.credits_used).slice(0, 20);
  if (users.length === 0) return <p className="text-sm text-slate-500">No users in snapshot.</p>;
  return (
    <Table>
      <THead>
        <TR>
          <TH>User</TH>
          <TH>Email</TH>
          <TH className="text-right">Credits</TH>
          <TH className="text-right">Messages</TH>
        </TR>
      </THead>
      <TBody>
        {users.map((u) => (
          <TR key={u.email}>
            <TD className="max-w-[140px] truncate">{u.name || "—"}</TD>
            <TD className="font-mono text-xs">{u.email}</TD>
            <TD className="text-right tabular-nums">{formatUsd(u.credits_used, { decimals: 2 })}</TD>
            <TD className="text-right tabular-nums">{u.messages}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function GenericCsvPreview({
  payload,
  title,
}: {
  payload: unknown;
  title: string;
}) {
  const p = payload as { rows?: Record<string, string>[] };
  const rows = p.rows ?? [];
  if (rows.length === 0) return <p className="text-sm text-slate-500">Empty.</p>;
  const keys = Object.keys(rows[0] ?? {}).slice(0, 8);
  return (
    <div className="overflow-auto max-h-72">
      <Table>
        <THead>
          <TR>
            {keys.map((k) => (
              <TH key={k} className="whitespace-nowrap">
                {k}
              </TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {rows.slice(0, 12).map((r, i) => (
            <TR key={i}>
              {keys.map((k) => (
                <TD key={k} className="max-w-[180px] truncate text-xs">
                  {r[k] ?? ""}
                </TD>
              ))}
            </TR>
          ))}
        </TBody>
      </Table>
      <p className="text-xs text-slate-500 mt-2">
        {title}: showing 12 of {rows.length} rows (trimmed for the browser).
      </p>
    </div>
  );
}

export function AnalyticsManualVendorCharts({
  snapshots,
}: {
  snapshots: ManualVendorSnapshotDTO[];
}) {
  if (snapshots.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">ChatGPT and Codex (imported exports)</CardTitle>
          <CardDescription>
            No snapshots yet.{" "}
            <Link href="/settings/imports" className="text-sky-700 underline underline-offset-2">
              Upload exports under Settings → Data imports
            </Link>
            .
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const workspace = findSnapshot(snapshots, "CODEX_WORKSPACE_JSON");
  const sessions = findSnapshot(snapshots, "CODEX_SESSIONS_JSON");
  const codeReview = findSnapshot(snapshots, "CODEX_CODE_REVIEW_JSON");
  const chatgptUsers = findSnapshot(snapshots, "CHATGPT_USERS_CSV");
  const gpts = findSnapshot(snapshots, "CHATGPT_GPTS_CSV");
  const projects = findSnapshot(snapshots, "CHATGPT_PROJECTS_CSV");
  const survey = findSnapshot(snapshots, "CHATGPT_IMPACT_SURVEY_CSV");
  const cursorTeam = findSnapshot(snapshots, "CURSOR_ANALYTICS_TEAM_CSV");

  function meta(s: ManualVendorSnapshotDTO | undefined) {
    if (!s) return null;
    return (
      <p className="text-xs text-slate-500 mb-2">
        File <span className="font-mono">{s.filename}</span> · imported{" "}
        {s.createdAt.slice(0, 16).replace("T", " ")} UTC
        {s.periodStart && s.periodEnd ? (
          <>
            {" "}
            · period {s.periodStart} → {s.periodEnd}
          </>
        ) : null}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 mb-1">
          ChatGPT and Codex (imported exports)
        </h2>
        <p className="text-xs text-slate-500 max-w-3xl mb-3">
          Latest snapshot per export type from{" "}
          <Link href="/settings/imports" className="underline underline-offset-2 text-slate-800">
            Settings → Data imports
          </Link>
          . Re-upload anytime to refresh.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Codex — workspace credits</CardTitle>
            <CardDescription>Daily totals from workspace usage JSON.</CardDescription>
          </CardHeader>
          <CardContent>
            {meta(workspace)}
            {workspace ? (
              <CodexWorkspaceChart payload={workspace.payload} />
            ) : (
              <p className="text-sm text-slate-500">No workspace JSON imported.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Codex — sessions credits by day</CardTitle>
            <CardDescription>Aggregated from per-user session rows.</CardDescription>
          </CardHeader>
          <CardContent>
            {meta(sessions)}
            {sessions ? (
              <CodexSessionsChart payload={sessions.payload} />
            ) : (
              <p className="text-sm text-slate-500">No sessions JSON imported.</p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Codex — GitHub code review metrics</CardTitle>
          </CardHeader>
          <CardContent>
            {meta(codeReview)}
            {codeReview ? (
              <CodexCodeReviewChart payload={codeReview.payload} />
            ) : (
              <p className="text-sm text-slate-500">No code review JSON imported.</p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">ChatGPT — top users by credits (import)</CardTitle>
            <CardDescription>From the Business users CSV.</CardDescription>
          </CardHeader>
          <CardContent>
            {meta(chatgptUsers)}
            {chatgptUsers ? (
              <ChatgptUsersTable payload={chatgptUsers.payload} />
            ) : (
              <p className="text-sm text-slate-500">No users CSV imported.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">ChatGPT — GPTs</CardTitle>
          </CardHeader>
          <CardContent>
            {meta(gpts)}
            {gpts ? <GenericCsvPreview payload={gpts.payload} title="GPTs" /> : null}
            {!gpts ? <p className="text-sm text-slate-500">No GPTs CSV.</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">ChatGPT — projects</CardTitle>
          </CardHeader>
          <CardContent>
            {meta(projects)}
            {projects ? <GenericCsvPreview payload={projects.payload} title="Projects" /> : null}
            {!projects ? <p className="text-sm text-slate-500">No projects CSV.</p> : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">ChatGPT — impact survey</CardTitle>
          </CardHeader>
          <CardContent>
            {meta(survey)}
            {survey ? <GenericCsvPreview payload={survey.payload} title="Survey" /> : null}
            {!survey ? <p className="text-sm text-slate-500">No survey CSV.</p> : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Cursor — team analytics CSV</CardTitle>
            <CardDescription>Daily active users and Chat volume when columns are present.</CardDescription>
          </CardHeader>
          <CardContent>
            {meta(cursorTeam)}
            {cursorTeam ? <CursorTeamChart payload={cursorTeam.payload} /> : null}
            {!cursorTeam ? <p className="text-sm text-slate-500">No Cursor team CSV.</p> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
