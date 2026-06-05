# Codex Enterprise Analytics API (OpenAPI)

**Status:** landed — all three `api.chatgpt.com` endpoints wired when
`INTEGRATION_CODEX_ENTERPRISE_ANALYTICS=real`.

This is **not** the Workspace Analytics beta (Compliance Logs JSONL). See
[workspace-analytics-api-beta.md](./workspace-analytics-api-beta.md) for ChatGPT Business
file-based analytics.

---

## Endpoints

| Path | Dashboard use |
|---|---|
| `GET …/usage?group=workspace` | F1 CODEX tile, `VendorDailySpend`, workspace credits chart |
| `GET …/usage?group=user` | Guardrails monitor, F9 seat MTD, sessions credits chart |
| `GET …/code_reviews` | Analytics → Codex GitHub code review metrics |
| `GET …/code_review_responses` | Analytics → code review user responses chart |

Base: `https://api.chatgpt.com/v1/analytics/codex/workspaces/{workspace_id}/…`

Auth: Platform API key with `codex.enterprise.analytics.read` (`OPENAI_CODEX_ANALYTICS_API_KEY`).
Workspace: `CHATGPT_WORKSPACE_ID` (or `OPENAI_CHATGPT_WORKSPACE_ID`).

---

## Sync jobs

| Trigger | Schedule | What runs |
|---|---|---|
| GHA `cron-vendor-spend-sync.yml` | `:25` hourly | `POST /api/cron/sync-codex-enterprise-spend` |
| Settings → Sync (FINOPS/ADMIN) | manual | same route |

Each run:

1. Upserts `VendorDailySpend` (CODEX) from workspace usage rows.
2. Writes `ProgramVendorExportSnapshot` rows:
   - `CODEX_WORKSPACE_JSON`
   - `CODEX_SESSIONS_JSON`
   - `CODEX_CODE_REVIEW_JSON`
   - `CODEX_CODE_REVIEW_RESPONSES_JSON`

Manual JSON/CSV uploads under Settings → Data imports remain a fallback for pre-enablement
history or when the API is unavailable.

---

## Code map

| Piece | Location |
|---|---|
| Fetch + pagination | `lib/integrations/codex-enterprise-analytics/fetch-workspace-usage.ts`, `fetch-paginated.ts` |
| API → snapshot payloads | `lib/integrations/codex-enterprise-analytics/api-to-snapshot-payload.ts` |
| Snapshot sync | `lib/integrations/codex-enterprise-analytics/sync-vendor-snapshots.ts` |
| Vendor spend + snapshots | `lib/vendor-spend/sync-codex-enterprise-daily.ts` |
| Guardrails (per-user usage) | `lib/guardrails/load-codex-usage-for-guardrail-monitor.ts` |
| User identity (`actor.email`, roster join) | `resolve-usage-row-identity.ts`, `build-codex-user-email-map.ts` |

Usage rows may include `actor.email`, `actor.user_id`, `models[]`, and `code_attribution` —
guardrails and monitor mapping preserve these fields for credit/posture rules.

---

## Operator smoke test

1. Set `INTEGRATION_CODEX_ENTERPRISE_ANALYTICS=real`, key + workspace id in Key Vault / `.env.local`.
2. Trigger sync (Settings or HMAC cron with `{"lookbackDays":14}`).
3. Confirm `VendorDailySpend` rows for vendor `codex_enterprise_analytics`.
4. Confirm four Codex snapshot kinds on Analytics / Program Health imports section.
5. Guardrails → Codex product filter shows per-user credit alerts when thresholds fire.
