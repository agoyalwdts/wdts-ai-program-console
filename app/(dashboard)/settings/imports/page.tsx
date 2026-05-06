import { Topbar } from "@/components/dashboard/topbar";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ImportEmployeesPanel } from "./import-employees-panel";
import { ImportProgramVendorPanel } from "./import-program-vendor-panel";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { KNOWN_COLUMNS, REQUIRED_COLUMNS, ALLOWED_STATUSES } from "@/lib/imports/employee-csv";

export const dynamic = "force-dynamic";

export default async function SettingsImportsPage() {
  await requireRole(["ADMIN", "FINOPS"]);

  // Snapshot of recent EMPLOYEE_IMPORT decisions so the operator can see
  // what's already been applied. Pulled server-side; refreshed on every
  // hard nav (force-dynamic above).
  const recent = await prisma.decision.findMany({
    where: { type: "EMPLOYEE_IMPORT" },
    orderBy: { ts: "desc" },
    take: 5,
    select: {
      id: true,
      ts: true,
      actorEmail: true,
      justification: true,
      afterState: true,
    },
  });

  const recentVendorExports = await prisma.decision.findMany({
    where: { type: "PROGRAM_VENDOR_EXPORT_IMPORT" },
    orderBy: { ts: "desc" },
    take: 5,
    select: {
      id: true,
      ts: true,
      actorEmail: true,
      justification: true,
      afterState: true,
    },
  });

  const userCount = await prisma.user.count();

  return (
    <>
      <Topbar
        title="Data imports"
        subtitle="Employee roster CSV and optional ChatGPT / Codex / Cursor admin exports."
      />
      <div className="p-6 space-y-6 max-w-5xl">
        <Card>
          <CardHeader>
            <CardTitle>Program vendor exports — ChatGPT, Codex, Cursor</CardTitle>
            <CardDescription>
              Until OpenAI and Codex analytics APIs are fully wired, drop the Business admin CSV/JSON
              exports here. ChatGPT users CSV and Codex workspace JSON update Program Health spend
              tiles via manual{" "}
              <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">VendorDailySpend</code>{" "}
              rows (live vendor syncs still take precedence). All accepted files also store the
              latest snapshot for the Analytics page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ImportProgramVendorPanel />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Employees — CSV upload</CardTitle>
            <CardDescription>
              Upsert by email. Existing rows are updated in-place; new rows
              are created; missing rows are <strong>not</strong> deleted (use
              status=LEFT instead). Currently {userCount} employees in the
              database.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ImportEmployeesPanel />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>CSV format</CardTitle>
            <CardDescription>
              Header row required. Column order doesn&apos;t matter. Unknown
              columns are ignored (the response will list them as a
              warning).
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-slate-700 space-y-3">
            <div>
              <div className="font-medium text-slate-900">Required</div>
              <ul className="list-disc list-inside text-slate-700 ml-2 mt-1">
                {REQUIRED_COLUMNS.map((c) => (
                  <li key={c}>
                    <code className="font-mono">{c}</code>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="font-medium text-slate-900">Optional</div>
              <ul className="list-disc list-inside text-slate-700 ml-2 mt-1">
                <li>
                  <code className="font-mono">managerEmail</code> — must
                  resolve to another row in the file or an existing
                  employee. Self-reference is rejected.
                </li>
                <li>
                  <code className="font-mono">status</code> — one of{" "}
                  {ALLOWED_STATUSES.map((s, i) => (
                    <span key={s}>
                      <code className="font-mono">{s}</code>
                      {i < ALLOWED_STATUSES.length - 1 ? ", " : ""}
                    </span>
                  ))}
                  . Defaults to <code className="font-mono">ACTIVE</code>.
                </li>
              </ul>
            </div>
            <div className="text-xs text-slate-500">
              Known columns:{" "}
              <code className="font-mono">{KNOWN_COLUMNS.join(", ")}</code>
            </div>
            <div>
              <a
                href="/api/imports/employees/sample"
                className="text-sky-600 underline-offset-4 hover:underline text-sm"
              >
                Download sample.csv
              </a>{" "}
              <span className="text-xs text-slate-500">
                (5 rows: a manager + four reports)
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent imports</CardTitle>
            <CardDescription>
              Pulled from the decision log (type =
              <code className="font-mono"> EMPLOYEE_IMPORT</code>). Last
              five.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <div className="text-sm text-slate-500">
                No imports yet. The first upload will show up here.
              </div>
            ) : (
              <ul className="text-sm text-slate-700 space-y-2">
                {recent.map((d) => {
                  const after = safeParse(d.afterState);
                  return (
                    <li
                      key={d.id}
                      className="border-b border-slate-100 pb-2 last:border-0"
                    >
                      <div className="text-slate-900">
                        {d.ts.toISOString().slice(0, 16).replace("T", " ")} UTC
                        — {d.actorEmail}
                      </div>
                      <div className="text-xs text-slate-500 font-mono">
                        added {fmt(after.added)} · updated {fmt(after.updated)}{" "}
                        · unchanged {fmt(after.unchanged)} · total{" "}
                        {fmt(after.total)}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent vendor exports</CardTitle>
            <CardDescription>
              Decision log type{" "}
              <code className="font-mono">PROGRAM_VENDOR_EXPORT_IMPORT</code> — last five bundles.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recentVendorExports.length === 0 ? (
              <div className="text-sm text-slate-500">No vendor export bundles yet.</div>
            ) : (
              <ul className="text-sm text-slate-700 space-y-2">
                {recentVendorExports.map((d) => {
                  const after = safeParse(d.afterState);
                  const kinds = Array.isArray(after.kinds)
                    ? (after.kinds as string[]).join(", ")
                    : "";
                  return (
                    <li
                      key={d.id}
                      className="border-b border-slate-100 pb-2 last:border-0"
                    >
                      <div className="text-slate-900">
                        {d.ts.toISOString().slice(0, 16).replace("T", " ")} UTC — {d.actorEmail}
                      </div>
                      <div className="text-xs text-slate-600 font-mono mt-0.5">{kinds}</div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return typeof v === "object" && v != null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function fmt(v: unknown): string {
  if (typeof v === "number" || typeof v === "string") return String(v);
  return "?";
}
