"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Match `.github/workflows/cron-vendor-spend-sync.yml` — long lookbacks timeout on App Service. */
const MANUAL_LOOKBACK_DAYS = 7;

async function readAdminSyncJson(res: Response): Promise<{
  ok?: boolean;
  error?: string;
  daysUpserted?: number;
  totalEvents?: number;
}> {
  const text = await res.text();
  if (!text.trim()) {
    if (res.status === 504 || res.status === 502 || res.status === 503) {
      throw new Error(
        `Request timed out or gateway error (${res.status}). Manual sync uses ${MANUAL_LOOKBACK_DAYS}d lookback; retry or use the hourly cron.`,
      );
    }
    throw new Error(`Empty response from server (${res.status} ${res.statusText}).`);
  }
  try {
    return JSON.parse(text) as {
      ok?: boolean;
      error?: string;
      daysUpserted?: number;
      totalEvents?: number;
    };
  } catch {
    throw new Error(`Invalid JSON (${res.status}): ${text.slice(0, 200)}`);
  }
}

export function SyncCursorVendorSpendButton() {
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [msg, setMsg] = useState("");

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={status === "loading"}
        onClick={async () => {
          setStatus("loading");
          setMsg("");
          try {
            const res = await fetch("/api/admin/sync-cursor-spend", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ lookbackDays: MANUAL_LOOKBACK_DAYS }),
            });
            const j = await readAdminSyncJson(res);
            if (!res.ok) {
              setStatus("err");
              setMsg(j.error ?? res.statusText);
              return;
            }
            setStatus("ok");
            setMsg(
              `Synced ${j.daysUpserted ?? 0} day bucket(s), ${j.totalEvents ?? 0} event(s).`,
            );
          } catch (e) {
            setStatus("err");
            setMsg(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        {status === "loading" ? "Syncing…" : "Sync Cursor spend (API)"}
      </Button>
      {msg ? (
        <p
          className={
            status === "err" ? "text-sm text-rose-600" : "text-sm text-emerald-700"
          }
        >
          {msg}
        </p>
      ) : null}
    </div>
  );
}
