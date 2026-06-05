"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2, Loader2, Upload } from "lucide-react";

type ApiOk = {
  ok: true;
  dryRun: boolean;
  notes?: string[];
  snapshots?: number;
  chatgptVendorDays?: number;
  codexVendorDays?: number;
  kinds?: string[];
  partialErrors?: string[];
};

type ApiErr = { ok: false; error?: string; errors?: string[]; notes?: string[] };

type ApiResponse = ApiOk | ApiErr;

type Slot = {
  name: string;
  label: string;
  hint: string;
  accept: string;
};

const SLOTS: Slot[] = [
  {
    name: "chatgptUsers",
    label: "ChatGPT — users export CSV",
    hint: "Walker Digital … users export (…).csv — drives Program Health ChatGPT credits",
    accept: ".csv,text/csv",
  },
  {
    name: "chatgptGpts",
    label: "ChatGPT — GPTs export CSV",
    hint: "… gpts export (…).csv",
    accept: ".csv,text/csv",
  },
  {
    name: "chatgptProjects",
    label: "ChatGPT — projects export CSV",
    hint: "… projects export (…).csv",
    accept: ".csv,text/csv",
  },
  {
    name: "chatgptImpactSurvey",
    label: "ChatGPT — impact survey CSV",
    hint: "… impact survey export (…).csv",
    accept: ".csv,text/csv",
  },
  {
    name: "codexWorkspaceUsage",
    label: "Codex — daily workspace usage JSON",
    hint: "codex-daily-workspace-usage-counts-*.json — daily credits for Health + charts",
    accept: ".json,application/json",
  },
  {
    name: "codexSessionsMessages",
    label: "Codex — daily sessions / messages JSON",
    hint: "codex-daily-sessions-messages-counts-*.json — analytics (fills CODEX spend if workspace file omitted)",
    accept: ".json,application/json",
  },
  {
    name: "codexCodeReview",
    label: "Codex — code review metrics JSON",
    hint: "codex-daily-code-review-metrics-*.json",
    accept: ".json,application/json",
  },
  {
    name: "cursorAnalyticsTeam",
    label: "Cursor — team Analytics CSV",
    hint: "Analytics_Team_*.csv — Cursor-only charts on Analytics page",
    accept: ".csv,text/csv",
  },
];

export function ImportProgramVendorPanel() {
  const [files, setFiles] = React.useState<Record<string, File | null>>({});
  const [busy, setBusy] = React.useState<"idle" | "dry" | "apply">("idle");
  const [result, setResult] = React.useState<ApiResponse | null>(null);

  function setSlot(name: string, f: File | null) {
    setFiles((prev) => ({ ...prev, [name]: f }));
    setResult(null);
  }

  async function submit(dryRun: boolean) {
    setBusy(dryRun ? "dry" : "apply");
    setResult(null);
    try {
      const form = new FormData();
      let any = false;
      for (const s of SLOTS) {
        const f = files[s.name];
        if (f) {
          form.append(s.name, f);
          any = true;
        }
      }
      if (!any) {
        setResult({ ok: false, error: "Select at least one file." });
        return;
      }
      const url = dryRun
        ? "/api/imports/program-vendor-exports?dryRun=1"
        : "/api/imports/program-vendor-exports";
      const res = await fetch(url, { method: "POST", body: form });
      const json = (await res.json()) as ApiResponse;
      setResult(json);
    } catch (e) {
      setResult({ ok: false, error: (e as Error).message });
    } finally {
      setBusy("idle");
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">
        Upload ChatGPT Business and Codex admin exports (and optional Cursor team CSV) for history
        or when live APIs are unavailable. When Codex Enterprise Analytics sync is enabled, the hourly
        cron replaces manual Codex JSON with API snapshots (workspace, sessions, code reviews,
        review responses). ChatGPT users CSV and Codex workspace JSON still update{" "}
        <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">VendorDailySpend</code> on
        import. OpenAI org costs and Codex Enterprise Analytics syncs override imports when active.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {SLOTS.map((s) => (
          <div
            key={s.name}
            className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 space-y-2"
          >
            <div className="text-sm font-medium text-slate-900">{s.label}</div>
            <p className="text-xs text-slate-500">{s.hint}</p>
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept={s.accept}
                className="text-xs w-full file:mr-2 file:rounded file:border-0 file:bg-slate-200 file:px-2 file:py-1"
                onChange={(e) => setSlot(s.name, e.target.files?.[0] ?? null)}
              />
              {files[s.name] ? (
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  {files[s.name]?.name.slice(0, 24)}
                  {(files[s.name]?.name.length ?? 0) > 24 ? "…" : ""}
                </Badge>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={busy !== "idle"}
          onClick={() => submit(true)}
        >
          {busy === "dry" ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Upload className="h-4 w-4 mr-2" />
          )}
          Validate (dry run)
        </Button>
        <Button type="button" disabled={busy !== "idle"} onClick={() => submit(false)}>
          {busy === "apply" ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <CheckCircle2 className="h-4 w-4 mr-2" />
          )}
          Apply import
        </Button>
      </div>

      {result && !result.ok ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 flex gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">Import failed</div>
            {"error" in result && result.error ? <p>{result.error}</p> : null}
            {"errors" in result && result.errors?.length ? (
              <ul className="list-disc pl-4 mt-1">
                {result.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : null}
            {result.notes?.length ? (
              <pre className="mt-2 text-xs whitespace-pre-wrap">{result.notes.join("\n")}</pre>
            ) : null}
          </div>
        </div>
      ) : null}

      {result && result.ok ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950 space-y-2">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="h-4 w-4" />
            {result.dryRun ? "Dry run OK" : "Import applied"}
          </div>
          {result.notes?.length ? (
            <pre className="text-xs whitespace-pre-wrap bg-white/60 rounded p-2 border border-emerald-100">
              {result.notes.join("\n")}
            </pre>
          ) : null}
          {!result.dryRun && result.snapshots != null ? (
            <p className="text-xs">
              Snapshots written: {result.snapshots}. Kinds:{" "}
              <span className="font-mono">{result.kinds?.join(", ")}</span>. Manual vendor days —
              ChatGPT: {result.chatgptVendorDays}, Codex: {result.codexVendorDays}.
            </p>
          ) : null}
          {result.partialErrors && result.partialErrors.length > 0 ? (
            <div className="text-amber-900 text-xs border border-amber-200 rounded p-2 bg-amber-50">
              <div className="font-medium">Partial warnings</div>
              <ul className="list-disc pl-4">
                {result.partialErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
