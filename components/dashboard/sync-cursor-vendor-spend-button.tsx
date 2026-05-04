"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

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
              body: JSON.stringify({ lookbackDays: 120 }),
            });
            const j = (await res.json()) as {
              ok?: boolean;
              error?: string;
              daysUpserted?: number;
              totalEvents?: number;
            };
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
