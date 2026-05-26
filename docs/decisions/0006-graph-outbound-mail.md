# 0006 — Outbound mail via Microsoft Graph sendMail

**Status:** accepted  
**Date:** 2026-05-25

## Context

Guardrail and Cursor prudence alerts email FinOps digests and end-user coaching
mail from the **hourly cron** (`POST /api/cron/guardrail-monitor`) and from
manual actions on `/settings/guardrails`. v0.2 used Resend (`RESEND_API_KEY`).

WDTS prefers mail to stay in Microsoft 365 (audit, transport, no extra vendor)
using the same Entra app registration as Azure AD / M365 Graph integrations.

## Decision

- Add **`lib/notify/graph-send.ts`** — `POST /users/{GRAPH_MAIL_SENDER}/sendMail`
  with app-only token from `AZURE_AD_*`.
- Add **`lib/notify/send-email.ts`** — routes to Graph or Resend via
  `EMAIL_PROVIDER` (`graph` | `resend`). Auto-selects **graph** when
  `GRAPH_MAIL_SENDER` and Azure creds are set.
- **Cron behaviour unchanged** — GitHub Actions still POSTs the HMAC cron
  endpoints; only the transport layer changes.
- Automated user coaching may email alert addresses **without** a dashboard
  `User` row; skip only when a row exists and `disabled=true`.

## Entra / Exchange requirements

1. **Application permission:** `Mail.Send` on the prod app registration
   (`e1bb9a0d-278-4f63-9442-d8fe427db8c3`) with admin consent.
2. **Shared mailbox** (or licensed sender): `GRAPH_MAIL_SENDER` App Setting
   (e.g. `wdts-ai-console@wdtablesystems.com`).
3. **Exchange Online application access policy** allowing the app to send as
   that mailbox (tenant-specific; M365 admin).

Resend remains available when `EMAIL_PROVIDER=resend` and `RESEND_API_KEY` is set.

## App settings (production)

| Setting | Example |
|---------|---------|
| `EMAIL_PROVIDER` | `graph` |
| `GRAPH_MAIL_SENDER` | `wdts-ai-console@wdtablesystems.com` |
| `USER_MODEL_COACHING_EMAIL` | `1` |
| `GUARDRAIL_ALERT_EMAIL_TO` | FinOps digest recipients |
| `AZURE_AD_*` | Same Key Vault refs as today |

## Open follow-ups

- Custom `GUARDRAIL_ALERT_EMAIL_FROM` display name on Graph messages.
- Retire Resend after Graph is verified in prod for 30 days.
