import Link from "next/link";
import type { UsageMirrorSnapshot } from "@/lib/gateway-mirror/usage-mirror-snapshot";
import type { GuardrailFeedStatus } from "@/lib/guardrails/feed-status";
import { Badge } from "@/components/ui/badge";
import { Activity, ChevronDown, Database } from "lucide-react";

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function modeBadge(mode: "real" | "synthetic", envKey: string) {
  return (
    <Badge variant={mode === "real" ? "success" : "secondary"}>
      {envKey}={mode}
    </Badge>
  );
}

export function GuardrailDataSourcesPanel({
  feeds,
  mirror,
}: {
  feeds: GuardrailFeedStatus;
  mirror: UsageMirrorSnapshot;
}) {
  const mirrorStale =
    !mirror.mirrorHealth.ok && mirror.mirrorHealth.stale && mirror.gatewayMode === "real";
  const mirrorEmpty = mirror.totalRows === 0;
  const mirrorNoRecent =
    mirror.rowsLast24Hours === 0 && mirror.gatewayMode === "real" && mirror.totalRows > 0;
  const mirrorWarn =
    !feeds.vendorFeedsActive && (mirrorEmpty || mirrorNoRecent || mirrorStale);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-800">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Activity className="h-4 w-4 text-sky-600" />
          <span className="font-medium text-slate-900">Guardrail data sources</span>
          {feeds.vendorFeedsActive ? (
            <Badge variant="success">Vendor feeds active</Badge>
          ) : (
            <Badge variant="warning">Vendor feeds off</Badge>
          )}
        </div>

        <ul className="space-y-2 text-sm text-slate-700">
          <li className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900">Cursor</span>
            {modeBadge(feeds.cursorMode, "INTEGRATION_CURSOR")}
            <span className="text-xs text-slate-500">
              Team Admin <code className="font-mono text-[11px]">filtered-usage-events</code>
            </span>
          </li>
          <li className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900">Codex</span>
            {modeBadge(feeds.codexMode, "INTEGRATION_CODEX_ENTERPRISE_ANALYTICS")}
            <span className="text-xs text-slate-500">Enterprise Analytics per-user buckets</span>
          </li>
        </ul>

        {feeds.vendorFeedsActive ? (
          <p className="mt-3 text-xs text-slate-600">
            Cursor and Codex guardrails scan live vendor APIs. A stale gateway mirror does not block
            these runs.
          </p>
        ) : (
          <p className="mt-3 text-xs text-amber-900">
            Enable <code className="font-mono text-[11px]">INTEGRATION_CURSOR=real</code> and/or{" "}
            <code className="font-mono text-[11px]">INTEGRATION_CODEX_ENTERPRISE_ANALYTICS=real</code>{" "}
            for live guardrail scans, or rely on the gateway mirror below.
          </p>
        )}
      </div>

      <details className="group rounded-lg border border-slate-200 bg-white text-sm text-slate-800">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-medium text-slate-900 hover:bg-slate-50">
          <ChevronDown className="h-4 w-4 text-slate-500 transition group-open:rotate-180" />
          <Database className="h-4 w-4 text-slate-600" />
          Gateway usage mirror (optional)
          {modeBadge(feeds.gatewayMode, "INTEGRATION_GATEWAY")}
          {mirrorStale && feeds.vendorFeedsActive ? (
            <Badge variant="secondary">stale — OK while vendor feeds active</Badge>
          ) : mirrorStale ? (
            <Badge variant="warning">ingest stale</Badge>
          ) : null}
        </summary>
        <div className="border-t border-slate-200 px-4 pb-4 pt-3">
          <UsageMirrorStatusPanel
            snapshot={mirror}
            variant="optional"
            vendorFeedsActive={feeds.vendorFeedsActive}
            showHeader={false}
          />
          {mirrorWarn ? (
            <p className="mt-3 text-xs text-amber-900">
              Without vendor feeds, guardrails depend on mirrored{" "}
              <code className="font-mono text-[11px]">UsageRecord</code> rows from webhook ingest.
            </p>
          ) : null}
        </div>
      </details>
    </div>
  );
}

export function UsageMirrorStatusPanel({
  snapshot,
  variant = "default",
  vendorFeedsActive = false,
  showHeader = true,
}: {
  snapshot: UsageMirrorSnapshot;
  variant?: "default" | "optional";
  vendorFeedsActive?: boolean;
  showHeader?: boolean;
}) {
  const optional = variant === "optional";
  const noData = snapshot.totalRows === 0;
  const noRecent =
    snapshot.rowsLast24Hours === 0 && snapshot.gatewayMode === "real";
  const alarming =
    !optional || !vendorFeedsActive
      ? noData || noRecent
      : noData && snapshot.gatewayMode === "real";

  return (
    <div
      className={
        alarming
          ? optional
            ? "rounded-md border border-slate-200 bg-slate-50/50 p-3 text-sm text-slate-800"
            : "rounded-lg border border-amber-200 bg-amber-50/80 p-4 text-sm text-slate-800"
          : optional
            ? "text-sm text-slate-800"
            : "rounded-lg border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-800"
      }
    >
      {showHeader ? (
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
            <Badge variant={vendorFeedsActive ? "secondary" : "warning"}>
              {vendorFeedsActive ? "ingest stale (optional)" : "ingest stale"}
            </Badge>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {!snapshot.usageIngestSecretSet ? (
            <Badge variant="warning">USAGE_INGEST_HMAC_SECRET unset</Badge>
          ) : null}
        </div>
      )}

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

      {noData && snapshot.gatewayMode === "real" && !vendorFeedsActive ? (
        <p className="mt-3 text-amber-900">
          No mirrored usage yet — the guardrail monitor has nothing to scan from the gateway. Wire{" "}
          <code className="font-mono text-xs">POST /api/webhooks/usage-ingest</code> (or LiteLLM)
          and set <code className="font-mono text-xs">INTEGRATION_GATEWAY=real</code>, or enable
          Cursor/Codex vendor feeds above.
        </p>
      ) : noData && optional ? (
        <p className="mt-3 text-slate-600">
          No mirrored usage rows yet. Optional for Cursor/Codex guardrails when vendor feeds are
          active; still used for ChatGPT gateway path and F1/F2 health tiles.
        </p>
      ) : noRecent && !vendorFeedsActive ? (
        <p className="mt-3 text-amber-900">
          No usage in the last 24 hours. Try <strong>Scan window → 24</strong> on a run, or check
          that your forwarder is still posting events.
        </p>
      ) : noRecent && optional && vendorFeedsActive ? (
        <p className="mt-3 text-slate-600">
          No mirrored usage in the last 24 hours. Expected when webhook ingest is paused; Cursor and
          Codex guardrails still scan their vendor APIs.
        </p>
      ) : snapshot.rowsLast2Hours === 0 && !optional ? (
        <p className="mt-3 text-slate-600">
          No rows in the last 2 hours — the default scan window will show{" "}
          <strong>0 usage row(s)</strong> until new events arrive or you pick a wider window.
        </p>
      ) : null}

      {!snapshot.mirrorHealth.ok && snapshot.mirrorHealth.stale && "reason" in snapshot.mirrorHealth ? (
        <p
          className={
            vendorFeedsActive && optional
              ? "mt-2 text-xs text-slate-500"
              : "mt-2 text-xs text-amber-800"
          }
        >
          {snapshot.mirrorHealth.reason}
        </p>
      ) : null}

      {showHeader ? (
        <p className="mt-3 text-xs text-slate-500">
          <Link href="/settings/gateway-mirror" className="text-sky-700 underline">
            Gateway usage mirror
          </Link>{" "}
          — webhook ingest for ChatGPT and cross-product rows. Configure forwarders on that page.
        </p>
      ) : (
        <p className="mt-3 text-xs text-slate-500">
          <Link href="/settings/gateway-mirror" className="text-sky-700 underline">
            Gateway usage mirror settings
          </Link>{" "}
          — webhook ingest and forwarder health.
        </p>
      )}
    </div>
  );
}
