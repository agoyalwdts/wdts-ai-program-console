"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FreshnessSummary } from "@/lib/sync";

function formatAge(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function isWarning(job: FreshnessSummary["jobs"][number], staleMs: number): boolean {
  if (job.lastError) return true;
  if (!job.lastSuccessAt) return true;
  return Date.now() - new Date(job.lastSuccessAt).getTime() > staleMs * 2;
}

const HOT_STALE_MS = 5 * 60_000;

export function SyncFreshnessBar({ summary }: { summary: FreshnessSummary }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const hotJobs = summary.jobs.filter((j) =>
    ["cursor_vendor_spend", "codex_enterprise_spend", "workspace_analytics", "unified_credits"].includes(
      j.key,
    ),
  );
  const warn = hotJobs.some((j) => isWarning(j, HOT_STALE_MS));
  const oldestIso = summary.oldestHotSuccessAt?.toISOString() ?? null;
  const justSynced = summary.refreshResult && summary.refreshResult.ran > 0;

  async function onRefresh() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/sync/refresh", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ force: true, tiers: ["hot", "warm"] }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) {
          setError(data.error ?? `Refresh failed (${res.status})`);
          return;
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Refresh failed");
      }
    });
  }

  return (
    <div
      className={cn(
        "border-b px-6 py-2 text-xs flex flex-wrap items-center gap-x-4 gap-y-1",
        warn ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-600",
      )}
    >
      <span>
        Data updated{" "}
        <span className="font-medium text-slate-800">{formatAge(oldestIso)}</span>
        {justSynced ? (
          <span className="text-slate-500">
            {" "}
            · synced {summary.refreshResult?.ran} source
            {summary.refreshResult?.ran === 1 ? "" : "s"}
          </span>
        ) : null}
      </span>
      <span className="hidden md:inline text-slate-400">|</span>
      <span className="hidden md:flex flex-wrap gap-x-3 gap-y-0.5" title="Per-source last success">
        {hotJobs.map((j) => (
          <span key={j.key} className={j.lastError ? "text-rose-700" : undefined}>
            {j.label}: {formatAge(j.lastSuccessAt?.toISOString() ?? null)}
          </span>
        ))}
      </span>
      <div className="ml-auto flex items-center gap-2">
        {error ? <span className="text-rose-700">{error}</span> : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          disabled={pending}
          onClick={() => void onRefresh()}
        >
          <RefreshCw className={cn("h-3 w-3 mr-1", pending && "animate-spin")} />
          Refresh data
        </Button>
      </div>
    </div>
  );
}
