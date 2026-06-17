"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  CURSOR_VENDOR_DEFAULT_BACKFILL_DAYS,
  CURSOR_VENDOR_SYNC_CHUNK_DAYS,
  cursorVendorBackfillChunks,
} from "@/lib/vendor-spend/cursor-vendor-sync-windows";

type SyncJson = {
  ok?: boolean;
  error?: string;
  daysUpserted?: number;
  totalEvents?: number;
};

async function readAdminSyncJson(res: Response): Promise<SyncJson> {
  const text = await res.text();
  if (!text.trim()) {
    if (res.status === 504 || res.status === 502 || res.status === 503) {
      throw new Error(
        `Request timed out or gateway error (${res.status}). Use chunked backfill or the hourly cron.`,
      );
    }
    throw new Error(`Empty response from server (${res.status} ${res.statusText}).`);
  }
  try {
    return JSON.parse(text) as SyncJson;
  } catch {
    throw new Error(`Invalid JSON (${res.status}): ${text.slice(0, 200)}`);
  }
}

async function postCursorSyncChunk(body: {
  lookbackDays: number;
  endOffsetDays: number;
  skipDecision: boolean;
}): Promise<SyncJson> {
  const res = await fetch("/api/admin/sync-cursor-spend", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await readAdminSyncJson(res);
  if (!res.ok) {
    throw new Error(j.error ?? res.statusText);
  }
  return j;
}

export function SyncCursorVendorSpendButton() {
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [msg, setMsg] = useState("");

  async function runQuickSync() {
    setStatus("loading");
    setMsg("");
    try {
      const j = await postCursorSyncChunk({
        lookbackDays: CURSOR_VENDOR_SYNC_CHUNK_DAYS,
        endOffsetDays: 0,
        skipDecision: false,
      });
      setStatus("ok");
      setMsg(`Synced ${j.daysUpserted ?? 0} day bucket(s), ${j.totalEvents ?? 0} event(s).`);
    } catch (e) {
      setStatus("err");
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function runBackfill() {
    setStatus("loading");
    setMsg("");
    const chunks = cursorVendorBackfillChunks(CURSOR_VENDOR_DEFAULT_BACKFILL_DAYS);
    let daysUpserted = 0;
    let totalEvents = 0;
    try {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        setMsg(`Backfill chunk ${i + 1}/${chunks.length}…`);
        const j = await postCursorSyncChunk({
          lookbackDays: chunk.lookbackDays,
          endOffsetDays: chunk.endOffsetDays,
          skipDecision: i < chunks.length - 1,
        });
        daysUpserted += j.daysUpserted ?? 0;
        totalEvents += j.totalEvents ?? 0;
      }
      setStatus("ok");
      setMsg(
        `Backfilled ${CURSOR_VENDOR_DEFAULT_BACKFILL_DAYS}d in ${chunks.length} chunks — ${daysUpserted} day bucket(s), ${totalEvents} event(s).`,
      );
    } catch (e) {
      setStatus("err");
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={status === "loading"}
          onClick={() => void runQuickSync()}
        >
          {status === "loading" && msg.startsWith("Backfill") ? "Working…" : status === "loading" ? "Syncing…" : "Sync last 7 days"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={status === "loading"}
          onClick={() => void runBackfill()}
        >
          {status === "loading" && msg.startsWith("Backfill")
            ? msg
            : `Backfill ${CURSOR_VENDOR_DEFAULT_BACKFILL_DAYS} days`}
        </Button>
      </div>
      {msg && !(status === "loading" && msg.startsWith("Backfill chunk")) ? (
        <p
          className={
            status === "err" ? "text-sm text-rose-600" : "text-sm text-emerald-700"
          }
        >
          {msg}
        </p>
      ) : null}
      {status === "loading" && msg.startsWith("Backfill chunk") ? (
        <p className="text-sm text-slate-600">{msg}</p>
      ) : null}
    </div>
  );
}
