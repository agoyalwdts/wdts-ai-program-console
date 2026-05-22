"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type MonitorSummary = {
  scannedUsageRows: number;
  scannedCursorEvents: number;
  cursorRowsInWindow: number;
  cursorFeedActive: boolean;
  cursorFeedSkipReason: string | null;
  scannedDecisions: number;
  candidates: number;
  inserted: number;
  emailed: number;
  emailError: string | null;
  userEmailed: number;
  userEmailAttempted: number;
  userEmailError: string | null;
};

export function RunGuardrailMonitorButton() {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [msg, setMsg] = useState("");
  const [windowHours, setWindowHours] = useState("2");

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs text-slate-600">
        Scan window (hours)
        <select
          className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900"
          value={windowHours}
          disabled={status === "loading"}
          onChange={(e) => setWindowHours(e.target.value)}
        >
          <option value="2">2 (hourly cron default)</option>
          <option value="6">6</option>
          <option value="24">24</option>
        </select>
      </label>
      <Button
        type="button"
        variant="default"
        size="sm"
        disabled={status === "loading"}
        onClick={async () => {
          setStatus("loading");
          setMsg("");
          try {
            const res = await fetch("/api/admin/run-guardrail-monitor", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ windowHours: Number(windowHours) }),
            });
            const j = (await res.json()) as {
              ok?: boolean;
              error?: string;
              summary?: MonitorSummary;
            };
            if (!res.ok || !j.ok || !j.summary) {
              setStatus("err");
              setMsg(j.error ?? res.statusText);
              return;
            }
            const s = j.summary;
            setStatus("ok");
            const cursorPart = s.cursorFeedActive
              ? `Cursor API ${s.cursorRowsInWindow} row(s) (${s.scannedCursorEvents} events), `
              : s.cursorFeedSkipReason
                ? `Cursor API off (${s.cursorFeedSkipReason}), `
                : "";
            setMsg(
              `${cursorPart}mirror ${s.scannedUsageRows} row(s), ${s.inserted} new alert(s), ` +
                `FinOps digest ${s.emailed}, user coaching ${s.userEmailed}/${s.userEmailAttempted}` +
                (s.emailError ? ` · digest err: ${s.emailError}` : "") +
                (s.userEmailError ? ` · user err: ${s.userEmailError}` : ""),
            );
            router.refresh();
          } catch (e) {
            setStatus("err");
            setMsg(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        {status === "loading" ? "Running…" : "Run guardrail monitor"}
      </Button>
      {msg ? (
        <p
          className={
            status === "err"
              ? "w-full text-sm text-rose-600"
              : "w-full text-sm text-emerald-700"
          }
        >
          {msg}
        </p>
      ) : null}
    </div>
  );
}
