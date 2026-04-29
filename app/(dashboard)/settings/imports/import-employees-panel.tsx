"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Loader2,
  Upload,
} from "lucide-react";
import type { ValidationError } from "@/lib/imports/employee-csv";

type ApiResponse =
  | {
      ok: true;
      dryRun: boolean;
      rowsParsed: number;
      rowsValid: number;
      unknownColumns: string[];
      summary?: {
        added: number;
        updated: number;
        unchanged: number;
        total: number;
      };
    }
  | {
      ok: false;
      dryRun?: boolean;
      error?: string;
      rowsParsed?: number;
      rowsValid?: number;
      unknownColumns?: string[];
      errors?: ValidationError[];
    };

export function ImportEmployeesPanel() {
  const [file, setFile] = React.useState<File | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [busy, setBusy] = React.useState<"idle" | "validating" | "applying">(
    "idle",
  );
  const [result, setResult] = React.useState<ApiResponse | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  function pickFile(f: File | null) {
    setFile(f);
    setResult(null);
  }

  async function submit(dryRun: boolean) {
    if (!file) return;
    setBusy(dryRun ? "validating" : "applying");
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const url = dryRun
        ? "/api/imports/employees?dryRun=1"
        : "/api/imports/employees";
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
            ? "border-sky-400 bg-sky-50"
            : "border-slate-300 bg-slate-50"
        }`}
      >
        <Upload className="h-6 w-6 text-slate-400 mb-2" />
        <div className="text-sm text-slate-700">
          Drag a CSV here, or
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="ml-1 text-sky-600 underline-offset-4 hover:underline"
          >
            choose a file
          </button>
        </div>
        <div className="text-xs text-slate-500 mt-1">
          UTF-8, max 5 MB. CSV only — re-export from Excel via Save As.
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
      </div>

      {file ? (
        <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2">
          <FileText className="h-4 w-4 text-slate-400" />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-slate-900 truncate">{file.name}</div>
            <div className="text-xs text-slate-500">
              {(file.size / 1024).toFixed(1)} KB
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => pickFile(null)}
            disabled={busy !== "idle"}
          >
            Remove
          </Button>
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Button
          onClick={() => submit(true)}
          disabled={!file || busy !== "idle"}
          variant="secondary"
        >
          {busy === "validating" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Validating…
            </>
          ) : (
            "Validate (dry-run)"
          )}
        </Button>
        <Button
          onClick={() => submit(false)}
          disabled={!file || busy !== "idle"}
        >
          {busy === "applying" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Importing…
            </>
          ) : (
            "Import"
          )}
        </Button>
        <div className="text-xs text-slate-500 ml-2">
          A dry-run parses + validates without writing.
        </div>
      </div>

      {result ? <ResultPanel result={result} /> : null}
    </div>
  );
}

function ResultPanel({ result }: { result: ApiResponse }) {
  if (result.ok) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-center gap-2 text-emerald-800 font-medium">
          <CheckCircle2 className="h-4 w-4" />
          {result.dryRun ? "Validation passed" : "Import committed"}
        </div>
        <div className="text-sm text-emerald-900 mt-2 space-y-1">
          <div>
            Parsed <strong>{result.rowsParsed}</strong> row
            {result.rowsParsed === 1 ? "" : "s"}, all valid.
          </div>
          {result.summary ? (
            <div className="font-mono text-xs">
              added {result.summary.added} · updated {result.summary.updated} ·
              unchanged {result.summary.unchanged} · total{" "}
              {result.summary.total}
            </div>
          ) : null}
          {result.unknownColumns.length > 0 ? (
            <div className="text-xs text-amber-700">
              Ignored columns:{" "}
              <code className="font-mono">
                {result.unknownColumns.join(", ")}
              </code>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-rose-200 bg-rose-50 p-4">
      <div className="flex items-center gap-2 text-rose-800 font-medium">
        <AlertCircle className="h-4 w-4" />
        {result.error ? "Upload rejected" : "Validation failed"}
      </div>
      <div className="text-sm text-rose-900 mt-2 space-y-2">
        {result.error ? (
          <pre className="text-xs whitespace-pre-wrap break-words">
            {result.error}
          </pre>
        ) : null}
        {typeof result.rowsParsed === "number" ? (
          <div className="text-xs text-rose-700">
            Parsed {result.rowsParsed} rows, {result.rowsValid ?? 0} would have
            been valid. No rows were written.
          </div>
        ) : null}
        {result.errors && result.errors.length > 0 ? (
          <div className="overflow-auto max-h-64 mt-1">
            <table className="text-xs w-full">
              <thead className="text-left text-rose-700">
                <tr>
                  <th className="pr-3 py-1 font-medium">Row</th>
                  <th className="pr-3 py-1 font-medium">Field</th>
                  <th className="py-1 font-medium">Problem</th>
                </tr>
              </thead>
              <tbody>
                {result.errors.slice(0, 200).map((e, i) => (
                  <tr key={i} className="border-t border-rose-200 align-top">
                    <td className="pr-3 py-1 font-mono text-rose-800">
                      {e.row}
                    </td>
                    <td className="pr-3 py-1 font-mono text-rose-800">
                      {e.field ?? "—"}
                    </td>
                    <td className="py-1 text-rose-900">{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.errors.length > 200 ? (
              <div className="text-xs text-rose-700 mt-1">
                + {result.errors.length - 200} more errors not shown. Fix the
                first ~200 and retry.
              </div>
            ) : null}
          </div>
        ) : null}
        {result.unknownColumns && result.unknownColumns.length > 0 ? (
          <div className="text-xs text-amber-700">
            <Badge variant="warning" className="mr-1">
              ignored
            </Badge>
            <code className="font-mono">
              {result.unknownColumns.join(", ")}
            </code>
          </div>
        ) : null}
      </div>
    </div>
  );
}
