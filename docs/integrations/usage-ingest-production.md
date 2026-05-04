# Production usage ingest (gateway mirror)

This runbook turns **`UsageRecord`** from an empty demo mirror into a live feed
so F1/F2/F3 and future analytics see **per-user / per-model** rows (while
vendor spend sync remains the source of truth for **dollar totals** on Cursor
and OpenAI where configured).

## 1. Dashboard side (one-time)

1. **Migrations** — `UsageRecord.sourceEventId` must exist (`prisma migrate deploy`).
2. **Secrets on App Service** (Key Vault references as today):
   - **`USAGE_INGEST_HMAC_SECRET`** — required for `POST /api/webhooks/usage-ingest`.
     If unset, the route returns **503** (fail-closed).
   - Optional: **`LITELLM_WEBHOOK_SECRET`** if you use **Ingest path B**
     (`POST /api/webhooks/litellm`) instead of or in addition to path A.
3. **Flip gateway reads** — set **`INTEGRATION_GATEWAY=real`** when you are
   satisfied that production traffic is mirrored (otherwise the app keeps the
   synthetic gateway for demos).
4. **Optional display helper** — set **`DASHBOARD_PUBLIC_BASE_URL`** to the
   canonical HTTPS origin (no trailing slash), e.g.
   `https://wdts-ai-program-console.azurewebsites.net`, so **Settings → Gateway
   usage mirror** can show full webhook URLs to operators.

## 2. Forwarder / pilot (path A — generic HMAC)

**Endpoint:** `{DASHBOARD_PUBLIC_BASE_URL}/api/webhooks/usage-ingest`

**Auth:** header `x-usage-ingest-signature: sha256=<hex>` where `<hex>` =
`HMAC_SHA256(USAGE_INGEST_HMAC_SECRET, raw_body)` (same pattern as
`lib/cron/auth.ts` and the Deel webhook).

**Body:** JSON `{ "events": [ … ] }` — schema and limits in
`app/api/webhooks/usage-ingest/route.ts` and `docs/gateway-and-litellm.md`.

**Rules that bite in prod:**

- Every **`userEmail`** must match an existing **`User.email`** in Postgres
  (closed-by-default access model). Unknown emails are **rejected** for that
  row (partial success).
- **`sourceEventId`** must be unique per event (idempotent upsert).

**Smoke test from an operator laptop** (after setting env vars):

```bash
export DASHBOARD_PUBLIC_BASE_URL='https://wdts-ai-program-console.azurewebsites.net'
export USAGE_INGEST_HMAC_SECRET='…'   # same value as App Service
export SMOKE_USER_EMAIL='you@yourorg.com'   # must exist in User table
./scripts/send-usage-ingest-smoke.sh
```

## 3. Path B — LiteLLM

If the proxy uses **generic_api** callbacks, follow **Ingest path B** in
`docs/gateway-and-litellm.md` (`LITELLM_WEBHOOK_SECRET`, user identity fields,
`metadata.wdts_product`, etc.).

## 4. Monitoring

- **Settings → Gateway usage mirror** — latest `UsageRecord.ts`, recent
  `USAGE_INGEST_BATCH` decisions, env flags.
- **GitHub Actions** — workflow **Cron — usage mirror health** (optional)
  calls `POST /api/cron/usage-mirror-health` daily. With
  `requireBatch: false`, a greenfield tenant stays green until the first batch;
  tighten to `requireBatch: true` once ingest must never be silent.

## 5. Relation to vendor spend sync

| Mechanism | Purpose |
|-----------|---------|
| **usage-ingest / litellm** | Row-level mirror: model, tokens, user, region — drives gateway aggregates and top spenders. |
| **sync-cursor-spend / sync-openai-spend** | Vendor-billed daily USD — overrides F1 tiles/chart when `VendorDailySpend` rows exist. |

Both can run in production; they answer different questions.
