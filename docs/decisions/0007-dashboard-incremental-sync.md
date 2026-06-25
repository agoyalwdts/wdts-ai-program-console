# 0007 — Dashboard incremental sync on open/refresh

## Status
accepted (2026-05-28)

## Context

Vendor spend and compliance-log mirrors (`VendorDailySpend`, `VendorUserDailySpend`, `ProgramVendorExportSnapshot`) were refreshed only by **hourly GitHub Actions cron** or **admin manual sync**. Dashboard pages read mirrors (or, for Codex F1, live API on every load). Operators had no unified view of **when data was last pulled**, and opening the dashboard could show data up to an hour stale.

## Decision

Introduce a **sync orchestrator** (`lib/sync/`) and **`IntegrationSyncState` ledger** (one row per job) that:

1. Runs **hot-tier delta syncs** on every dashboard layout mount when mirrors are stale (>5 min since last success), blocking up to **~45s** before render (parallel jobs; Codex gets up to 40s).
2. Honors **`?refresh=1`** (or `?refresh=true`) on any dashboard URL — proxy stamps a request header; layout runs hot-tier sync with **`force: true`** (bypasses staleness + 30s debounce).
3. Exposes **`POST /api/sync/refresh`** for manual refresh (hot + warm tiers, 60s budget, optional `force`).
4. Routes **cron** and **admin** sync endpoints through the same `executeSyncJob()` helpers so all triggers update the ledger.
5. Shows a **freshness bar** with per-source last-success times and a **Refresh data** button.

### Job registry (v1)

| Key | Tier | Stale (page load) | Delta |
|-----|------|-------------------|-------|
| `cursor_vendor_spend` | hot | 5 min | MTD floor (local month start → today), cap 31 |
| `codex_enterprise_spend` | hot | 5 min | MTD floor, cap 31 |
| `workspace_analytics` | hot | 5 min | MTD floor, cap 31; compliance log cursor |
| `unified_credits` | hot | 5 min | MTD floor, cap 31; compliance log cursor |
| `openai_org_costs` | warm | 60 min | cap 7 / 31 |

**Excluded from v1 orchestrator:** Azure AD reconciler (separate nightly cron), gateway `UsageRecord` webhook ingest, M365 Graph live tiles, OpenAI org roster / Cursor SCIM read-through clients, Anthropic, Deel.

### F1 Codex

After layout refresh, F1 **prefers `VendorDailySpend` mirror** (source label: sync mirror) and only calls live `api.chatgpt.com` when the mirror is empty.

## Consequences

- First dashboard open after deploy may take up to ~45s while hot deltas run (Codex Enterprise Analytics is the long pole).
- Multi-tab page loads within 30s debounce skip duplicate hot syncs (unless `?refresh=1`).
- Cron remains a safety net; ledger prevents redundant full lookbacks when page_load ran recently.
- New migration: `IntegrationSyncState`.

## Open follow-ups

- Background refresh (render immediately, sync after response) if 15s block is too slow in prod.
- Mirror M365 / roster / SCIM clients into Postgres for full offline dashboard.
- FinOps-only gating on `/api/sync/refresh`.
- Azure AD identity as optional warm-tier manual refresh.
