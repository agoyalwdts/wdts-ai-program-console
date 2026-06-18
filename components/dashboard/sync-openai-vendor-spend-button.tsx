"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  OPENAI_VENDOR_DEFAULT_BACKFILL_DAYS,
  OPENAI_VENDOR_SYNC_CHUNK_DAYS,
  openAiVendorBackfillChunks,
} from "@/lib/vendor-spend/openai-vendor-sync-windows";

type SyncJson = {
  ok?: boolean;
  error?: string;
  daysUpserted?: number;
  totalCostRows?: number;
};

async function readAdminSyncJson(res: Response): Promise<SyncJson> {
  const text = await res.text();
  if (!text.trim()) {
    if (res.status === 504 || res.status === 502 || res.status === 503) {
      throw new Error(
        `Request timed out or gateway error (${res.status}). Use chunked backfill or the twice-daily cron.`,
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

async function postOpenAiSyncChunk(body: {
  lookbackDays: number;
  endOffsetDays: number;
  skipDecision: boolean;
}): Promise<SyncJson> {
  const res = await fetch("/api/admin/sync-openai-spend", {
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

export function SyncOpenAiVendorSpendButton() {
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [msg, setMsg] = useState("");

  async function runQuickSync() {
    setStatus("loading");
    setMsg("");
    try {
      const j = await postOpenAiSyncChunk({
        lookbackDays: OPENAI_VENDOR_SYNC_CHUNK_DAYS,
        endOffsetDays: 0,
        skipDecision: false,
      });
      setStatus("ok");
      setMsg(
        `Synced ${j.daysUpserted ?? 0} VendorDailySpend row(s), ${j.totalCostRows ?? 0} cost line(s).`,
      );
    } catch (e) {
      setStatus("err");
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function runBackfill() {
    setStatus("loading");
    setMsg("");
    const chunks = openAiVendorBackfillChunks(OPENAI_VENDOR_DEFAULT_BACKFILL_DAYS);
    let daysUpserted = 0;
    let totalCostRows = 0;
    try {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        setMsg(`Backfill chunk ${i + 1}/${chunks.length}…`);
        const j = await postOpenAiSyncChunk({
          lookbackDays: chunk.lookbackDays,
          endOffsetDays: chunk.endOffsetDays,
          skipDecision: i < chunks.length - 1,
        });
        daysUpserted += j.daysUpserted ?? 0;
        totalCostRows += j.totalCostRows ?? 0;
      }
      setStatus("ok");
      setMsg(
        `Backfilled ${OPENAI_VENDOR_DEFAULT_BACKFILL_DAYS}d in ${chunks.length} chunks — ${daysUpserted} VendorDailySpend row(s), ${totalCostRows} cost line(s).`,
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
          {status === "loading" && msg.startsWith("Backfill") ? "Working…" : status === "loading" ? "Syncing…" : "Sync last 31 days"}
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
            : `Backfill ${OPENAI_VENDOR_DEFAULT_BACKFILL_DAYS} days`}
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
