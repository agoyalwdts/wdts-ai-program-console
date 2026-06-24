# Unified Credit Usage API (COSTS alpha)

OpenAI Compliance Logs `event_type=COSTS` — hourly unified ChatGPT + Codex
credit rows (user, product, SKU, tokens, credits). Alpha spec: OpenAI support
PDF *Unified Credit Usage API* (16 Jun 2026).

## Dashboard wiring

| Piece | Location |
|-------|----------|
| Sync | `lib/integrations/unified-credits/sync.ts` |
| Cron | `POST /api/cron/sync-unified-credits` (HMAC) |
| Vendor key | `OPENAI_UNIFIED_CREDITS_COMPLIANCE` → `VendorDailySpend` + `VendorUserDailySpend` |
| Snapshots | `ProgramVendorExportSnapshot.kind = UNIFIED_CREDITS_COSTS` |

Requires `INTEGRATION_OPENAI_COMPLIANCE=real`, `OPENAI_COMPLIANCE_API_KEY`,
**`OPENAI_ORG_ID`** (organization-scoped — **not** `CHATGPT_WORKSPACE_ID`).

### Compliance path (important)

COSTS is **organization-scoped**. List/download via:

```http
GET https://api.chatgpt.com/v1/compliance/organizations/{OPENAI_ORG_ID}/logs?event_type=COSTS&after=…
```

Workspace Analytics (`CHATGPT_USER_*`) and `AUTH_LOG` remain on:

```http
GET …/compliance/workspaces/{CHATGPT_WORKSPACE_ID}/logs?event_type=…
```

OpenAI support case **10188319** (June 2026) confirmed the workspace path returns
empty/invalid results for COSTS even when org enablement is live.

## Enablement status

As of 2026-06-24, `GET …/organizations/org-…/logs?event_type=COSTS` returns **HTTP 200**
with JSONL file listings when probed with the compliance platform key.

## When live

1. Hourly cron + page-load sync ingest COSTS JSONL (30-day lookback, max 90).
2. **F1 + chargeback** prefer `OPENAI_UNIFIED_CREDITS_COMPLIANCE` over Workspace
   Analytics pool totals and CSV snapshots when mirror rows exist
   (`lib/f1-unified-credits-spend.ts`, `lib/chargeback/aggregate-user-spend.ts`).
3. Validate against Credit Usage Report CSV for one 16th→15th billing period.

## Open follow-ups (tracked with OpenAI)

- Stable dedupe key for warehouse upsert
- Billing-period (16th→15th) vs UTC day/hour semantics
- ≥90-day backfill / retention
- Scoped credit-only API key
