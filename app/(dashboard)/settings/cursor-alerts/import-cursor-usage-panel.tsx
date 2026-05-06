"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2, Loader2, Upload } from "lucide-react";

type ApiOk =
  | {
    ok: true;
    dryRun: boolean;
    rowsParsed?: number;
    rowsSkipped?: number;
    parseErrors?: string[];
    alertsWouldCreate?: number;
    alertsInserted?: number;
    candidatesEvaluated?: number;
    eventsFetched?: number;
    rowsMapped?: number;
    sample?: Array<{
      userEmail: string;
      model: string;
      costUsd: number;
      ruleCode: string;
      title: string;
    }>;
  }
  | { ok: false; error?: string };

export function ImportCursorUsagePanel() {
  const [file, setFile] = React.useState<File | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [busy, setBusy] = React.useState<"idle" | "dry" | "apply">("idle");
  const [result, setResult] = React.useState<ApiOk | null>(null);
  const [lookbackDays, setLookbackDays] = React.useState(7);
  const [apiBusy, setApiBusy] = React.useState<"idle" | "dry" | "apply">("idle");
  const [apiResult, setApiResult] = React.useState<ApiOk | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  function pickFile(f: File | null) {
    setFile(f);
    setResult(null);
  }

  async function submit(dryRun: boolean) {
    if (!file) return;
    setBusy(dryRun ? "dry" : "apply");
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const url = dryRun
        ? "/api/imports/cursor-usage?dryRun=1"
        : "/api/imports/cursor-usage";
      const res = await fetch(url, { method: "POST", body: form });
      const json = (await res.json()) as ApiOk;
      setResult(json);
    } catch (e) {
      setResult({ ok: false, error: (e as Error).message });
    } finally {
      setBusy("idle");
    }
  }

  async function submitApi(dryRun: boolean) {
    setApiBusy(dryRun ? "dry" : "apply");
    setApiResult(null);
    try {
      const url = dryRun
        ? "/api/imports/cursor-prudence-api?dryRun=1"
        : "/api/imports/cursor-prudence-api";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lookbackDays }),
      });
      const json = (await res.json()) as ApiOk;
      setApiResult(json);
    } catch (e) {
      setApiResult({ ok: false, error: (e as Error).message });
    } finally {
      setApiBusy("idle");
    }
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) pickFile(f);
        }}
        className={`flex flex-col items-center justify-center rounded-md border-2 border-dashed px-6 py-8 transition-colors ${
          dragOver
            ? "border-amber-400 bg-amber-50"
            : "border-slate-300 bg-slate-50"
        }`}
      >
        <Upload className="h-6 w-6 text-slate-400 mb-2" />
        <div className="text-sm text-slate-700">
          Drag the Cursor team-usage CSV here, or
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="ml-1 text-amber-700 underline-offset-4 hover:underline"
          >
            choose file
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
        {file ? (
          <div className="mt-3 text-xs font-mono text-slate-600">{file.name}</div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!file || busy !== "idle"}
          onClick={() => submit(true)}
        >
          {busy === "dry" ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Scanning…
            </>
          ) : (
            "Dry run"
          )}
        </Button>
        <Button
          type="button"
          disabled={!file || busy !== "idle"}
          onClick={() => submit(false)}
        >
          {busy === "apply" ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Importing…
            </>
          ) : (
            "Create alerts"
          )}
        </Button>
      </div>

      {result && !result.ok ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 flex gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>{result.error ?? "Request failed"}</div>
        </div>
      ) : null}

      {result && result.ok ? (
        <div className="rounded-md border border-slate-200 bg-white p-4 text-sm space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span className="font-medium text-slate-900">
              {result.dryRun ? "Dry run complete" : "Import complete"}
            </span>
            {result.dryRun ? (
              <Badge variant="secondary">no writes</Badge>
            ) : (
              <Badge variant="success">saved</Badge>
            )}
          </div>
          <ul className="text-slate-700 space-y-1 list-disc pl-5">
            <li>Rows parsed: {result.rowsParsed}</li>
            {result.rowsSkipped != null ? (
              <li>Rows skipped: {result.rowsSkipped}</li>
            ) : null}
            {result.dryRun && result.alertsWouldCreate != null ? (
              <li>Would create alerts: {result.alertsWouldCreate}</li>
            ) : null}
            {!result.dryRun && result.alertsInserted != null ? (
              <li>New alert rows: {result.alertsInserted}</li>
            ) : null}
            {!result.dryRun && result.candidatesEvaluated != null ? (
              <li>Rule hits (incl. duplicates skipped): {result.candidatesEvaluated}</li>
            ) : null}
          </ul>
          {result.parseErrors && result.parseErrors.length > 0 ? (
            <details className="text-xs text-amber-800">
              <summary className="cursor-pointer">Parse warnings ({result.parseErrors.length})</summary>
              <ul className="mt-1 font-mono max-h-32 overflow-y-auto">
                {result.parseErrors.slice(0, 20).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {result.sample && result.sample.length > 0 ? (
            <details className="text-xs">
              <summary className="cursor-pointer text-slate-600">Sample ({result.sample.length})</summary>
              <ul className="mt-2 space-y-1 font-mono text-[11px]">
                {result.sample.map((s, i) => (
                  <li key={i}>
                    {s.userEmail} · {s.model.slice(0, 40)}
                    … · ${s.costUsd.toFixed(2)} · {s.ruleCode}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4 space-y-3">
        <div className="text-sm font-medium text-slate-900">Sync from Cursor Admin API</div>
        <p className="text-xs text-slate-600 leading-relaxed">
          Pulls granular usage events (token fields + charged amount) from{" "}
          <code className="font-mono text-[11px]">POST /teams/filtered-usage-events</code>. Needs{" "}
          <code className="font-mono text-[11px]">INTEGRATION_CURSOR=real</code> and{" "}
          <code className="font-mono text-[11px]">CURSOR_TEAM_ADMIN_API_KEY</code> (or{" "}
          <code className="font-mono text-[11px]">CURSOR_ADMIN_TOKEN</code>). Respects Cursor rate
          limits; default window is the last N days (max 30).
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <span>Lookback</span>
            <select
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
              value={lookbackDays}
              onChange={(e) => setLookbackDays(Number(e.target.value))}
            >
              {[7, 14, 30].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={apiBusy !== "idle"}
            onClick={() => submitApi(true)}
          >
            {apiBusy === "dry" ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Scanning…
              </>
            ) : (
              "API dry run"
            )}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={apiBusy !== "idle"}
            onClick={() => submitApi(false)}
          >
            {apiBusy === "apply" ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Syncing…
              </>
            ) : (
              "Sync from API"
            )}
          </Button>
        </div>

        {apiResult && !apiResult.ok ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 flex gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>{apiResult.error ?? "Request failed"}</div>
          </div>
        ) : null}

        {apiResult && apiResult.ok ? (
          <div className="rounded-md border border-slate-200 bg-white p-4 text-sm space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span className="font-medium text-slate-900">
                {apiResult.dryRun ? "API dry run complete" : "API sync complete"}
              </span>
              {apiResult.dryRun ? (
                <Badge variant="secondary">no writes</Badge>
              ) : (
                <Badge variant="success">saved</Badge>
              )}
            </div>
            <ul className="text-slate-700 space-y-1 list-disc pl-5">
              {apiResult.eventsFetched != null ? (
                <li>Events fetched: {apiResult.eventsFetched.toLocaleString()}</li>
              ) : null}
              {apiResult.rowsMapped != null ? (
                <li>Mapped rows (email + model): {apiResult.rowsMapped.toLocaleString()}</li>
              ) : null}
              {apiResult.dryRun && apiResult.alertsWouldCreate != null ? (
                <li>Would create alerts: {apiResult.alertsWouldCreate}</li>
              ) : null}
              {!apiResult.dryRun && apiResult.alertsInserted != null ? (
                <li>New alert rows: {apiResult.alertsInserted}</li>
              ) : null}
              {!apiResult.dryRun && apiResult.candidatesEvaluated != null ? (
                <li>Rule hits (incl. duplicates skipped): {apiResult.candidatesEvaluated}</li>
              ) : null}
            </ul>
            {apiResult.sample && apiResult.sample.length > 0 ? (
              <details className="text-xs">
                <summary className="cursor-pointer text-slate-600">Sample ({apiResult.sample.length})</summary>
                <ul className="mt-2 space-y-1 font-mono text-[11px]">
                  {apiResult.sample.map((s, i) => (
                    <li key={i}>
                      {s.userEmail} · {s.model.slice(0, 40)}
                      … · ${s.costUsd.toFixed(2)} · {s.ruleCode}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
