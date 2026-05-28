# Workspace Analytics API (OpenAI beta)

**Status:** beta access granted (OpenAI case **08499651**, April 2026). **Sync landed** in
`lib/integrations/workspace-analytics/` — hourly cron `POST /api/cron/sync-workspace-analytics`
when `INTEGRATION_OPENAI_COMPLIANCE=real`.  
**Source:** `workspace-analytics-api-spec-beta.pdf` (Compliance Logs–delivered analytics feed).

This is **not** the same integration as **Codex Enterprise Analytics** (`GET /v1/analytics/codex/workspaces/{id}/usage`). That REST API powers guardrails, F1 Codex credit rollups, and seat enrichment today. The beta spec is a **file-based ChatGPT workspace analytics** feed on the **Compliance Logs Platform**, aimed at warehouse/BI ingestion.

---

## At a glance

| | Codex Enterprise Analytics (landed) | Workspace Analytics API (beta) |
|---|---|---|
| Base | `https://api.chatgpt.com` | Same host, **compliance** paths |
| Path | `/v1/analytics/codex/workspaces/{workspace_id}/usage` | `/v1/compliance/workspaces/{workspace_id}/logs` (+ download) |
| Auth key | `OPENAI_CODEX_ANALYTICS_API_KEY` | Same platform as compliance: **`OPENAI_COMPLIANCE_API_KEY`** (confirm scope with OpenAI) |
| Workspace | `CHATGPT_WORKSPACE_ID` | Same |
| Shape | Paginated JSON (`credits`, `turns`, `clients`) | Immutable **JSONL files** listed by `event_type` |
| Dashboard use today | Guardrails monitor, Codex MTD, top spenders (sessions JSON) | Would replace **manual CSV exports** for ChatGPT Business analytics |

---

## API surface (beta spec)

**List files**

```http
GET /v1/compliance/workspaces/{workspace_id}/logs
  ?event_type=CHATGPT_USER_ANALYTICS
  &after={iso8601}
  &before={optional}
  &limit=...
```

**Download file**

```http
GET /v1/compliance/workspaces/{workspace_id}/logs/{log_file_id}
```

**Incremental polling:** persist `last_end_time` from the list response; use it as the next `after`. Files are immutable; **dedupe records on `event_id`** (duplicates may appear across files).

**Launch behavior:** forward-only — no historical backfill at GA; only events after beta/launch appear.

---

## Event types (`event_type` query param)

| `event_type` | Grain | Replaces / complements |
|---|---|---|
| `CHATGPT_USER_ANALYTICS` | 1 row / user / calendar day | Manual **Business users** CSV (`CHATGPT_USERS_CSV` import) — `messages`, `credits_used`, GPT/tool/project breakdowns, `email`, `user_id`, … |
| `CHATGPT_PROJECT_ANALYTICS` | 1 row / project / day | `CHATGPT_PROJECTS_CSV` |
| `CHATGPT_GPT_ANALYTICS` | 1 row / GPT / day | `CHATGPT_GPTS_CSV` |
| `CHATGPT_SURVEY_ANALYTICS` | 1 row / survey answer | `CHATGPT_IMPACT_SURVEY_CSV` |

**Record envelope** (each JSONL line): `event_id`, `type`, `timestamp`, `principal`, `actor`, plus a type-specific analytics payload. Warehouse upsert keys are documented per type (e.g. `workspace_id` + `event_date` + `user_id` for user analytics).

**Semantics:** reporting snapshots for a day — **not** live inventory. Do not expect row-for-row match with compliance inventory APIs.

---

## What we already have

| Piece | Location |
|---|---|
| List + download compliance logs | `lib/integrations/openai-compliance/fetch.ts` |
| AUTH_LOG ingestion (F2 sign-in IPs) | `lib/integrations/openai-compliance/summarize-auth-log-ips.ts` |
| Manual ChatGPT CSV path | `lib/imports/program-vendor-export/` kinds `CHATGPT_*_CSV` |
| Codex usage REST (separate) | `lib/integrations/codex-enterprise-analytics/` |

Adding workspace analytics is mostly: **new `event_type` values**, **JSONL parsers**, and a **cron/sync job** that writes `ProgramVendorExportSnapshot` (or dedicated tables) instead of operators uploading CSVs.

---

## Implementation (landed)

| Piece | Location |
|---|---|
| JSONL parsers (all 4 types) | `lib/integrations/workspace-analytics/parse-jsonl.ts` |
| Incremental sync + dedupe | `lib/integrations/workspace-analytics/sync.ts` |
| Snapshot + vendor spend ingest | `lib/integrations/workspace-analytics/ingest.ts` |
| Cron | `POST /api/cron/sync-workspace-analytics` (HMAC) |
| GHA schedule | `.github/workflows/cron-vendor-spend-sync.yml` (`35 * * * *`) |
| F1 top spenders | reads `CHATGPT_USER_ANALYTICS` snapshots (same `users[]` shape as CSV) |

Snapshot kinds: `CHATGPT_USER_ANALYTICS`, `CHATGPT_PROJECT_ANALYTICS`, `CHATGPT_GPT_ANALYTICS`,
`CHATGPT_SURVEY_ANALYTICS`. Watermark: `WORKSPACE_ANALYTICS_SYNC_STATE`.

## Operator smoke test

1. `INTEGRATION_OPENAI_COMPLIANCE=real`, compliance key + `CHATGPT_WORKSPACE_ID` set.
2. `curl` the cron endpoint (or wait for hourly GHA) with HMAC body `{"initialLookbackDays":7}`.
3. Confirm `ProgramVendorExportSnapshot` rows for the four kinds and a `Decision` of type
   `PROGRAM_VENDOR_EXPORT_IMPORT`.

**Out of scope:** pre-beta backfill; live inventory reconciliation; Codex REST merge.

---

## Operator checklist (beta)

- [ ] Confirm beta entitlement on the **same** ChatGPT Enterprise workspace as `CHATGPT_WORKSPACE_ID`.
- [ ] Confirm compliance API key can list `CHATGPT_USER_ANALYTICS` (may need OpenAI to enable analytics `event_type` on the key).
- [ ] Note beta is **forward-only** — plan exports accordingly; manual CSV may still be needed for pre-beta periods.
- [ ] Store `last_end_time` once sync lands; do not re-process entire history every hour.

---

## References

- OpenAI Compliance Platform (existing): [Compliance API cookbook](https://developers.openai.com/cookbook/examples/chatgpt/compliance_api/logs_platform)
- Internal: `docs/deploy/azure.md` (`OPENAI-COMPLIANCE-API-KEY`), `AGENTS.md` §6.1 `openaicompliance`
- Codex REST (unchanged): `lib/integrations/codex-enterprise-analytics/fetch-workspace-usage.ts`
