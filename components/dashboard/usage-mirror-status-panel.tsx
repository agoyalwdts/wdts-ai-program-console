import Link from "next/link";
import type { UsageMirrorSnapshot } from "@/lib/gateway-mirror/usage-mirror-snapshot";
import { Badge } from "@/components/ui/badge";
import { Database } from "lucide-react";

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function UsageMirrorStatusPanel({ snapshot }: { snapshot: UsageMirrorSnapshot }) {
  const noData = snapshot.totalRows === 0;
  const noRecent =
    snapshot.rowsLast24Hours === 0 && snapshot.gatewayMode === "real";

  return (
    <div
      className={
        noData || noRecent
          ? "rounded-lg border border-amber-200 bg-amber-50/80 p-4 text-sm text-slate-800"
          : "rounded-lg border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-800"
      }
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Database className="h-4 w-4 text-slate-600" />
        <span className="font-medium text-slate-900">Usage mirror status</span>
        <Badge variant={snapshot.gatewayMode === "real" ? "success" : "secondary"}>
          INTEGRATION_GATEWAY={snapshot.gatewayMode}
        </Badge>
        {!snapshot.usageIngestSecretSet ? (
          <Badge variant="warning">USAGE_INGEST_HMAC_SECRET unset</Badge>
        ) : null}
        {!snapshot.mirrorHealth.ok && snapshot.mirrorHealth.stale ? (
          <Badge variant="warning">ingest stale</Badge>
        ) : null}
      </div>

      <dl className="grid gap-2 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-slate-500">Total UsageRecord rows</dt>
          <dd className="font-mono text-sm">{snapshot.totalRows.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Rows in last 2h (default scan)</dt>
          <dd className="font-mono text-sm">{snapshot.rowsLast2Hours.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Rows in last 24h</dt>
          <dd className="font-mono text-sm">{snapshot.rowsLast24Hours.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Latest usage event</dt>
          <dd className="font-mono text-xs">{formatWhen(snapshot.lastUsageEventAt)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-slate-500">Latest webhook ingest batch</dt>
          <dd className="font-mono text-xs">{formatWhen(snapshot.lastIngestBatchAt)}</dd>
        </div>
      </dl>

      {noData ? (
        <p className="mt-3 text-amber-900">
          No mirrored usage yet — the guardrail monitor has nothing to scan. Wire{" "}
          <code className="font-mono text-xs">POST /api/webhooks/usage-ingest</code> (or LiteLLM)
          and set <code className="font-mono text-xs">INTEGRATION_GATEWAY=real</code>.
        </p>
      ) : noRecent ? (
        <p className="mt-3 text-amber-900">
          No usage in the last 24 hours. Try <strong>Scan window → 24</strong> on a run, or check
          that your forwarder is still posting events.
        </p>
      ) : snapshot.rowsLast2Hours === 0 ? (
        <p className="mt-3 text-slate-600">
          No rows in the last 2 hours — the default scan window will show{" "}
          <strong>0 usage row(s)</strong> until new events arrive or you pick a wider window.
        </p>
      ) : null}

      {!snapshot.mirrorHealth.ok && snapshot.mirrorHealth.stale && "reason" in snapshot.mirrorHealth ? (
        <p className="mt-2 text-xs text-amber-800">{snapshot.mirrorHealth.reason}</p>
      ) : null}

      <p className="mt-3 text-xs text-slate-500">
        <Link href="/settings/gateway-mirror" className="text-sky-700 underline">
          Gateway usage mirror
        </Link>{" "}
        — webhook URLs, env checklist, recent ingest batches. Cursor/Codex vendor sync does not
        feed this table.
      </p>
    </div>
  );
}
