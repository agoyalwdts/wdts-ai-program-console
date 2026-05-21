# Gateway usage mirror — operator guidelines

This document is the **single place** for how WDTS mirrors LLM usage into the
dashboard Postgres `UsageRecord` table and how **LiteLLM** fits next to generic
ingest. A **remote gateway vendor pull** is still deferred — see
`lib/gateway-mirror/vendor-remote-pull.ts` (placeholder, no network). The live
mirror is **push-based** (webhooks).

## Goals

- **F1 / F2 / F3** (and future analytics) read usage through `getGatewayClient()`
  when `INTEGRATION_GATEWAY=real` — rows come from **`UsageRecord`**, not live
  vendor pulls.
- **No prompt or response bodies** in the mirror (policy: gateway retains
  full content under its own retention; the dashboard stores metadata only).

### Cursor (parallel path — vendor-accurate F1)

When `INTEGRATION_CURSOR=real`, Program Health can show **Cursor-billed USD**
from the **Cursor Team Admin API** (`POST /teams/filtered-usage-events`, sum
`chargedCents`), stored in **`VendorDailySpend`** and refreshed by
`POST /api/cron/sync-cursor-spend` (HMAC) or **Settings → Sync Cursor spend**.
This does **not** replace the gateway mirror for other products; it only
overrides the **CURSOR** tile and chart series when sync data exists for the
selected period. See Cursor docs: Admin API (Basic auth with the team API key).

### OpenAI ChatGPT + Codex (parallel path — vendor-accurate F1)

When `INTEGRATION_OPENAI=real`, Program Health can show **organization-billed
USD** from **`GET /v1/organization/costs`** (admin API key + `OpenAI-Organization`),
bucketed into **`VendorDailySpend`** rows for **`CHATGPT`** and **`CODEX`**.
Refresh via `POST /api/cron/sync-openai-spend` (HMAC) or **Settings → Sync ChatGPT + Codex spend**.
Line items are mapped with heuristics (`codex` in the string → Codex, etc.),
optional JSON env **`OPENAI_COST_LINE_ITEM_SUBSTRINGS_JSON`**, and
**`OPENAI_COST_UNMAPPED_SPLIT`** (`ratio` default, or force `CHATGPT` / `CODEX`)
for API spend that does not match a rule.

## Prerequisites

1. Run migrations so `UsageRecord.sourceEventId` exists (idempotent upserts).
2. Set **`INTEGRATION_GATEWAY=real`** in the deployment environment after you
   begin ingesting events (otherwise the app keeps the synthetic gateway read
   path for dev/demo).

## WDTS operational note — LiteLLM deferred

**As of 2026-05, WDTS does not run a LiteLLM proxy.** Treat **Ingest path A**
(generic HMAC, `POST /api/webhooks/usage-ingest`) as the integration surface
until Platform / AI gateway stands up LiteLLM (or another forwarder that can
emit the same normalised JSON).

**Future:** When a LiteLLM host exists, follow **Ingest path B** below
(`config.yaml`, `Authorization: Bearer …`, `llm_api_success` /
`llm_api_failure`). Production may already expose `LITELLM_WEBHOOK_SECRET` and
`LITELLM_DEFAULT_*` App Settings so the dashboard side is ready; no LiteLLM
deployment is required for those vars to remain unset or unused on the proxy.

## Ingest path A — Generic HMAC (`POST /api/webhooks/usage-ingest`)

**Production runbook** (App Service secrets, pilot smoke, monitoring): see
`docs/integrations/usage-ingest-production.md`.

- **Auth:** `USAGE_INGEST_HMAC_SECRET` must be set. Header
  **`x-usage-ingest-signature: sha256=<HMAC_SHA256(secret, raw body)>`**
  (same construction as `lib/cron/auth.ts` and the Deel webhook).
- **Body:** JSON `{ "events": [ … ] }` — at most **500** events per request.
  Each event must include a unique **`sourceEventId`**, **`userEmail`** matching
  a `User.email` in Postgres, **`product`** (`CHATGPT`, `CODEX`, `CURSOR`,
  `CLAUDE_AI`, `M365_COPILOT`), **`model`**, **`region`**, **`ts`** (ISO-8601),
  optional tokens/cost/`decision`/`dlpLayersHit`.
- **Canonical schema:** see the file header in
  `app/api/webhooks/usage-ingest/route.ts`.

Use this path for **any** forwarder that can emit the normalised shape (not
only LiteLLM).

## Ingest path B — LiteLLM generic_api (`POST /api/webhooks/litellm`)

LiteLLM’s **generic_api** callback sends batches of **`StandardLoggingPayload`**
shaped logs. The dashboard maps them to the same `UsageRecord` rows.

### LiteLLM `config.yaml` (minimal)

```yaml
litellm_settings:
  callbacks: ["wdts_dashboard"]
callback_settings:
  wdts_dashboard:
    callback_type: generic_api
    endpoint: https://<dashboard-host>/api/webhooks/litellm
    headers:
      Authorization: "Bearer ${LITELLM_WEBHOOK_SECRET}"
    event_types:
      - llm_api_success
      - llm_api_failure
```

### Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `LITELLM_WEBHOOK_SECRET` | Yes | Must match the `Authorization: Bearer …` value. If unset, the route returns **503**. |
| `LITELLM_DEFAULT_PRODUCT` | No | Default `Product` when not inferred and no `metadata.wdts_product`. Default **`CHATGPT`**. |
| `LITELLM_DEFAULT_REGION` | No | Default region string. Default **`global`**. |
| `LITELLM_INFER_CURSOR_PRODUCT` | No | Default **on**. Set **`0`** or **`false`** to disable **Cursor** inference (see below). |

### User identity (required)

Every log must resolve to a **dashboard user email** so the row can join to
`User.id`. The normaliser looks in this order (first hit wins):

- `metadata.spend_logs_metadata.user_email` / `wdts_user_email` / `email`
- `metadata.user_email` / `wdts_user_email`
- `metadata.user_api_key_user_id` if it looks like an email
- `end_user` if it contains `@`

In dev, the seeded owner **`agoyal@wdtablesystems.com`** is a convenient test
value. In production, pass the real WDTS work email (must exist in `User`).

### Product: OpenAI-shaped default vs **Cursor**

When **`LITELLM_DEFAULT_PRODUCT=CHATGPT`** (typical for OpenAI API traffic through
the proxy), you still want **Cursor IDE** completions stored as **`CURSOR`**.

**Explicit (always wins):** set `metadata.wdts_product` (or
`spend_logs_metadata.wdts_product`) to a valid `Product` enum string, e.g.
`CURSOR`, `CHATGPT`, `CODEX`.

**Inference (when `LITELLM_INFER_CURSOR_PRODUCT` is not disabled):** if there is
**no** explicit product field, the service sets **`CURSOR`** when any of these
hold:

- **`api_base`** or **`hidden_params.api_base`** matches **`cursor.com`** or
  **`cursor.sh`**
- **`request_tags`** contains `cursor`, `wdts:cursor`, or a tag starting with
  `cursor:`
- **`metadata.requester_custom_headers`**: the **`user-agent`** header or any
  **`x-*`** header value contains the word **`Cursor`** (typical Cursor IDE UA)
- **`metadata.requester_metadata.wdts_client`** is **`cursor`** (optional hook
  for a custom forwarder)

If none of the above apply, **`LITELLM_DEFAULT_PRODUCT`** is used.

**Important:** If Cursor calls **OpenAI** via `api.openai.com`, **`api_base`**
alone may **not** identify Cursor. Prefer **`request_tags`**, **`User-Agent`**,
or explicit **`metadata.wdts_product: CURSOR`**.

### Idempotency

LiteLLM log **`id`** is stored as **`sourceEventId`** = `litellm:<id>` so
replays of the same completion do not duplicate rows.

## Decision log — batch rows (`USAGE_INGEST_BATCH`)

Each successful webhook batch that **upserts at least one** `UsageRecord`
appends a **`Decision`** row with `type = USAGE_INGEST_BATCH`, actor
`gateway-mirror.ingest@wdts.local`, and JSON `beforeState` / `afterState`
(source id, counts, sample of rejections). Idempotent replays that write **zero**
rows do **not** create a decision.

- **F5 / operators:** filter the ledger or use **Settings → Gateway usage mirror**
  (`/settings/gateway-mirror`) for recent batches and last `UsageRecord.ts`.

## Cron — mirror freshness (`POST /api/cron/usage-mirror-health`)

Same **HMAC** contract as `POST /api/cron/reconcile-azuread` (`CRON_SHARED_SECRET`,
header `x-cron-signature`, body JSON). Optional fields:

- `maxStaleMinutes` (default **1440**) — fail if the latest `USAGE_INGEST_BATCH`
  decision is older than this window.
- `requireBatch` (default **false**) — when **true**, return **503** until the
  first successful batch has landed (greenfield alerting).

**503** means unhealthy (silent mirror); **200** returns `lastIngestBatchAt` /
`lastUsageEventAt` JSON.

## Public liveness — `GET /api/health`

Returns `{ ok: true, service: "wdts-ai-program-console" }` with no auth (listed in
`auth.ts` `PUBLIC_PATHS`). Used by load balancers, **Playwright** (`e2e/health.spec.ts`),
and quick `curl` checks.

## Smoke scripts (local)

From the repo root (dev server running, DB migrated, secrets set on **both**
client env and server):

```bash
USAGE_INGEST_HMAC_SECRET='…' npm run smoke:usage-ingest
LITELLM_WEBHOOK_SECRET='…' npm run smoke:litellm
```

Optional: `BASE_URL`, `SMOKE_USER_EMAIL`. Implementations:
`scripts/gateway-mirror/smoke-usage-ingest.ts`, `smoke-litellm.ts`.

## Fixtures (tests)

Committed JSON under `tests/fixtures/litellm/` is loaded by
`lib/integrations/litellm/fixtures.test.ts` to lock normalisation behaviour.

## Playwright

- `npm run build` then `npm run test:e2e` — starts `next start` on **`PLAYWRIGHT_PORT`**
  (default **3101**, so it does not collide with `npm run dev` on 3000) unless
  `PLAYWRIGHT_SKIP_WEBSERVER=1` (then point `PLAYWRIGHT_BASE_URL` at your server).
- CI runs the health spec after `npm run build` (see `.github/workflows/ci.yml`).

## Operational checks

1. **Dry security:** webhook URLs are public; only **Bearer** / **HMAC**
   secrets protect them. Rotate secrets in Key Vault (or your secret store)
   with the same discipline as `CRON_SHARED_SECRET`.
2. **Payload size:** LiteLLM route rejects bodies over **5 MB**; generic ingest
   over **2 MB** — tune LiteLLM batch settings if you hit limits.
3. **Rejected rows:** responses include a **`rejected`** array with reasons
   (e.g. unknown email); fix upstream metadata rather than widening DB joins
   silently.

## Code pointers

| Topic | Location |
|-------|----------|
| Generic ingest route | `app/api/webhooks/usage-ingest/route.ts` |
| LiteLLM route | `app/api/webhooks/litellm/route.ts` |
| LiteLLM → ingest mapping + Cursor inference | `lib/integrations/litellm/normalize.ts` |
| Bearer verification | `lib/webhooks/litellm-bearer.ts` |
| Prisma upsert | `lib/usage-ingest/apply.ts` |
| Gateway read path (mirror) | `lib/integrations/gateway/postgres-mirror.ts` |
| Batch `Decision` writer | `lib/gateway-mirror/record-ingest-decision.ts` |
| Mirror health evaluation | `lib/gateway-mirror/mirror-health.ts` |
| Health cron route | `app/api/cron/usage-mirror-health/route.ts` |
| Settings UI | `app/(dashboard)/settings/gateway-mirror/page.tsx` |
| Remote pull placeholder | `lib/gateway-mirror/vendor-remote-pull.ts` |
| Public `/api/health` | `app/api/health/route.ts` |

## Model coaching emails (end users)

When usage is mirrored with `model` + token counts, the guardrail monitor
(`POST /api/cron/guardrail-monitor`) can email **the person who used the model**
(not only FinOps) for complexity coaching rules such as
`NON_COMPLEX_HEAVY_MODEL_SELECTED`.

| Variable | Purpose |
|----------|---------|
| `USER_MODEL_COACHING_EMAIL` | `1` / `true` — master switch |
| `USER_MODEL_COACHING_ALLOW_DEV` | Required in dev/sandbox so local cron does not mail real users |
| `RESEND_API_KEY` | Resend API key (same as operator digests) |
| `GUARDRAIL_USER_COACHING_RULE_CODES` | Optional comma list; defaults to the three complexity/posture rules |
| `USER_MODEL_COACHING_BCC` | Optional BCC (defaults to `GUARDRAIL_ALERT_EMAIL_TO`) |

Cursor prudence ingest/cron uses the same switch. Only **`User` rows with
`disabled=false`** receive mail. `userEmailNotifiedAt` on alert rows prevents
duplicate coaching for the same deduped finding.

## Related reading

- `AGENTS.md` — integration table and open blockers.
- `README.md` — high-level project overview and setup.
- LiteLLM generic API: <https://litellm.vercel.app/docs/observability/generic_api>
- Standard logging payload: <https://docs.litellm.ai/docs/proxy/logging_spec>
