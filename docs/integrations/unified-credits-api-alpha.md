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
`CHATGPT_WORKSPACE_ID` (same as Workspace Analytics / AUTH_LOG).

## Enablement status

As of 2026-06-19, OpenAI support confirmed WDTS workspace alpha enablement, but
`GET …/logs?event_type=COSTS` still returns `400 Invalid event_type COSTS`
while `CHATGPT_USER_ANALYTICS` and `AUTH_LOG` return `200`. The cron treats
`notEnabled: true` as a soft skip until OpenAI flips the flag.

## When live

1. Hourly cron ingests COSTS JSONL (30-day lookback, max 90).
2. F1 / chargeback can prefer `OPENAI_UNIFIED_CREDITS_COMPLIANCE` over CSV
   (follow-up PR).
3. Validate against Credit Usage Report CSV for one 16th→15th billing period.

## Open follow-ups (tracked with OpenAI)

- Stable dedupe key for warehouse upsert
- Billing-period (16th→15th) vs UTC day/hour semantics
- ≥90-day backfill / retention
- Scoped credit-only API key
