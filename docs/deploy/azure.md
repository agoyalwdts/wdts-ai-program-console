# Azure deploy runbook — `wdts-ai-program-console`

> **Status:** v0.2 preview live at
> https://wdts-ai-program-console.azurewebsites.net/. Authentication
> end-to-end verified against the WDTS Microsoft Entra ID tenant on
> 2026-04-28. Two known deviations from LDR 0003 in this preview shape;
> see §7. **Authority for the choices below:**
> [`docs/decisions/0003-deploy-target.md`](../decisions/0003-deploy-target.md).
> Read that LDR first if you're new to this; the rationale lives there,
> the steps live here.

This runbook turns an empty Azure subscription into a working production
deployment of the dashboard. It is intentionally explicit — every choice
has a default, and every secret has exactly one home (Key Vault).

## What you'll have at the end

- An App Service Linux web app at
  `https://<app-name>.azurewebsites.net` running Next.js on Node 20.
- An Azure Database for PostgreSQL Flexible Server (PG16) reachable
  only over the VNet — no public access.
- An Azure Key Vault holding every secret the app reads.
- A system-assigned managed identity on the web app, authorised to
  read those secrets via Key Vault refs.
- A fresh Microsoft Entra ID app registration scoped to production,
  with the `groups` claim configured and the high-privilege Graph
  scopes admin-consented.
- A GitHub Actions workflow on `main` that deploys via OIDC — no
  long-lived secret stored in the repo.

The dev / sandbox AAD app registration in `.env.local` stays exactly
as it is. It is **not** the production registration.

---

## 0. Prerequisites

Bullet-list pass / fail. Every line must be `[x]` before step 1.

- [ ] WDTS-corp Azure subscription and resource-group name pinned
  (the subscription the personal increment apps live on is **not**
  this one).
- [ ] Region picked: `centralindia` **or** `eastus` (LDR 0003 — not
  `australiaeast`).
- [ ] You can `az login` against that subscription.
- [ ] You have permission to create:
  - Resource groups.
  - App Service plans.
  - Postgres Flexible Servers.
  - Key Vaults.
  - Microsoft Entra ID app registrations + grant admin consent.
  - GitHub Actions environments + repository secrets.
- [ ] You know which Key Vault auth mode you want. Plain **Contributor**
  on the resource group is **not** enough to assign RBAC roles on a
  Key Vault — that requires `Microsoft.Authorization/roleAssignments/write`,
  which sits with **Owner** or **User Access Administrator**. If you only
  have Contributor, use the bootstrap script's default
  `KV_AUTH_MODE=access-policy` (the v0.2 preview path). Switching from
  access-policy mode to RBAC mode in-place also requires `roleAssignments/write`,
  so this is a "decide before creating the vault" choice. See §7 for the
  full deviation note.
- [ ] GitHub: branch protection on `main` (so the deploy workflow only
  runs on reviewed code).
- [ ] At least one human reviewer named for the GitHub `production`
  environment (`AGENTS.md` §10 N4).

If any line is `[ ]`, stop. The runbook is harder to undo than to skip.

---

## 1. Provision Azure resources

Run `docs/deploy/azure-bootstrap.sh`. It is parameterised at the top of
the file:

```bash
SUBSCRIPTION_ID=""               # az account show --query id -o tsv
RESOURCE_GROUP="wdts-ai-program-console-rg"
LOCATION="centralindia"          # or eastus
APP_NAME="wdts-ai-program-console"
PLAN_SKU="B2"                    # B2 by default; Linux
PG_NAME="${APP_NAME}-db"
PG_SKU="Standard_B1ms"
PG_VERSION="16"
KV_NAME="${APP_NAME}-kv"         # must be globally unique; tweak if collision
KV_AUTH_MODE="access-policy"     # or "rbac" — needs Owner; see §0 + §7
PG_PUBLIC_ACCESS="Enabled"       # or "Disabled" — needs VNet integration
```

Read the script before you run it. It is the sample — not a
production-ready operator script. The bootstrap script:

1. Selects the subscription and creates the resource group.
2. Creates the App Service Plan (Linux, B2).
3. Creates the web app with `NODE:20-lts`, `WEBSITES_PORT=3000`,
   `--https-only true`.
4. Creates the Postgres Flexible Server (PG16, B1ms) with public access
   per `PG_PUBLIC_ACCESS`. When `Enabled` (preview default), it adds
   firewall rules for Azure services and the operator's current IP.
   When `Disabled` (LDR 0003 target), VNet integration must be wired
   separately before the App Service can reach the DB. The admin
   password is randomly generated and written **only** to Key Vault.
5. Creates the Key Vault per `KV_AUTH_MODE`. In `access-policy` mode
   (preview default) the script then sets explicit access policies for
   the operator and the web app's managed identity. In `rbac` mode
   (LDR 0003 target) the script assigns `Key Vault Secrets Officer`
   to the operator and `Key Vault Secrets User` to the managed
   identity — those calls require Owner / User Access Administrator.
6. Stores every secret listed in the "Secrets" section below as
   placeholders.
7. Enables system-assigned managed identity on the web app.
8. Wires App Settings as Key Vault references (one per secret).

The script is idempotent on re-run — every `az ... create` is wrapped
in `az ... show || az ... create`. **It does not deploy any code.**
That happens in step 5.

---

## 2. Create the production Microsoft Entra ID app registration

This is the step LDR 0003 calls "do not reuse the dev/sandbox
registration." Manual via the Portal because the Graph admin-consent
grant needs a privileged human anyway.

1. Azure Portal → Microsoft Entra ID → App registrations → **New
   registration**.
   - **Name:** `wdts-ai-program-console (prod)` — the suffix matters,
     it's how reconciler logs distinguish dev vs prod.
   - **Supported account types:** "Accounts in this organizational
     directory only (single tenant)".
   - **Redirect URI:** Web →
     `https://<app-name>.azurewebsites.net/api/auth/callback/microsoft-entra-id`.
2. Note the new **Application (client) ID** — this becomes
   `AZURE_AD_CLIENT_ID` in production.
3. Certificates & secrets → **New client secret** — 24-month
   expiry. Copy the value once. Drop it straight into Key Vault as
   `AZURE-AD-CLIENT-SECRET` and close the Portal blade. **Never paste
   it anywhere else.**
4. Token configuration → **Add groups claim** → "Security groups"
   → save. Without this, RBAC falls back to the email-rule bridge
   in `lib/auth-roles.ts`, which is a sandbox-only pattern.
5. API permissions → **Add a permission** → Microsoft Graph →
   Application permissions → add:
   - `User.Read.All`
   - `Reports.Read.All`
   - (later, when F11 lands) `AuditLog.Read.All`
6. **Grant admin consent for WDTS** — top of the API permissions
   blade. This is the privilege that the dev/sandbox app
   intentionally does not have.
7. (When the AAD security groups exist — `AGENTS.md` §13) populate
   `AZURE_AD_GROUP_{ADMIN,FINOPS,MANAGER}_IDS` as Key Vault secrets.
   They're plain object IDs, not credentials, but Key Vault is the
   right home for "config the app reads at boot" alongside the
   secrets.

---

## 3. Secrets — what goes into Key Vault

Every name below is a Key Vault secret. The web app's App Settings
reference each via
`@Microsoft.KeyVault(SecretUri=https://<kv>.vault.azure.net/secrets/<NAME>)`.
None of these values lives anywhere else in production.

| Secret name (Key Vault) | App env var | Source |
|---|---|---|
| `AZURE-AD-TENANT-ID` | `AZURE_AD_TENANT_ID` | Entra ID tenant overview |
| `AZURE-AD-CLIENT-ID` | `AZURE_AD_CLIENT_ID` | Step 2 above (**prod** app id, not dev) |
| `AZURE-AD-CLIENT-SECRET` | `AZURE_AD_CLIENT_SECRET` | Step 2 above |
| `AUTH-SECRET` | `AUTH_SECRET` | `openssl rand -base64 32` — generated locally, never committed |
| `DATABASE-URL` | `DATABASE_URL` | Built from PG admin connection string + the password the bootstrap script created |
| `POLICYREPO-TOKEN` | `POLICYREPO_TOKEN` | Fine-grained PAT, scoped to `agoyalwdts/wdts-ai-policy`. **Do not issue this until branch protection is on the policy repo** (`AGENTS.md` §13) |
| `OPENAI-ADMIN-API-KEY` | `OPENAI_ADMIN_API_KEY` | OpenAI org admin keys |
| `OPENAI-ORG-ID` | `OPENAI_ORG_ID` | OpenAI org settings |
| `ANTHROPIC-ADMIN-API-KEY` | `ANTHROPIC_ADMIN_API_KEY` | Anthropic workspace admin keys |
| `ANTHROPIC-ORG-ID` | `ANTHROPIC_ORG_ID` | Anthropic workspace settings |
| `ANTHROPIC-WORKSPACE-ID` | `ANTHROPIC_WORKSPACE_ID` | Anthropic workspace settings |
| `AZURE-OPENAI-ENDPOINT` | `AZURE_OPENAI_ENDPOINT` | Prod Azure OpenAI resource (separate from dev) |
| `AZURE-OPENAI-API-KEY` | `AZURE_OPENAI_API_KEY` | Prod Azure OpenAI resource |
| `CURSOR-SCIM-BASE-URL` | `CURSOR_SCIM_BASE_URL` | Cursor admin |
| `CURSOR-ADMIN-TOKEN` | `CURSOR_ADMIN_TOKEN` | Cursor admin |
| `DEEL-API-TOKEN` | `DEEL_API_TOKEN` | Deel admin |
| `DEEL-WEBHOOK-SECRET` | `DEEL_WEBHOOK_SECRET` | `openssl rand -hex 32` — also configured on the Deel side |
| `USAGE-INGEST-HMAC-SECRET` | `USAGE_INGEST_HMAC_SECRET` | `openssl rand -hex 32` — HMAC for `POST /api/webhooks/usage-ingest` (`x-usage-ingest-signature`). See [`docs/gateway-and-litellm.md`](../gateway-and-litellm.md). |
| `LITELLM-WEBHOOK-SECRET` | `LITELLM_WEBHOOK_SECRET` | Bearer for `POST /api/webhooks/litellm` only. Unset / placeholder until LiteLLM callbacks exist; route returns **503** if unset when called. |

Non-secret App Settings (set as plain values, not Key Vault refs):

| App Setting | Value |
|---|---|
| `WEBSITES_PORT` | `3000` |
| `NODE_ENV` | `production` |
| `AUTH_TRUST_HOST` | `true` |
| `AUTH_URL` | `https://<app-name>.azurewebsites.net` |
| `INTEGRATION_GATEWAY` | `synthetic` on a fresh bootstrap until usage events are ingested; flip to **`real`** once `USAGE_INGEST_HMAC_SECRET` is live and `UsageRecord` rows exist (Program Health reads the mirror). |
| `INTEGRATION_AZUREAD` | `real` |
| `INTEGRATION_CURSOR` | `real` |
| `INTEGRATION_OPENAI` | `real` |
| `INTEGRATION_ANTHROPIC` | `real` |
| `INTEGRATION_M365GRAPH` | `real` |
| `INTEGRATION_DEEL` | `real` |
| `INTEGRATION_POLICYREPO` | `real` (only after `POLICYREPO-TOKEN` is in Key Vault and branch protection is enabled on the policy repo) |
| `POLICYREPO_OWNER` | `agoyalwdts` |
| `POLICYREPO_NAME` | `wdts-ai-policy` |
| `POLICYREPO_DEFAULT_BRANCH` | `main` |

**Rotation pattern.** Any of these is rotated by:
1. Rotate the secret at the source (Entra ID, vendor admin panel, etc.).
2. Update the Key Vault secret value.
3. Restart the web app once. App Service re-resolves Key Vault refs
   on restart.

No code change, no redeploy, no commit.

### 3.1 Gateway usage mirror — Key Vault (not plain App Settings)

`USAGE_INGEST_HMAC_SECRET` and `LITELLM_WEBHOOK_SECRET` must live in **Key
Vault** and be referenced from App Service, same as `AZURE_AD_CLIENT_SECRET`.
Do **not** leave the usage-ingest HMAC as a long-term plain configuration
value.

**Greenfield** (`azure-bootstrap.sh` seeds placeholders and wires refs).

**Brownfield** (you temporarily set a plain `USAGE_INGEST_HMAC_SECRET` in
Configuration): copy the working value into Key Vault, replace the app
setting with a reference, restart once:

```bash
VAULT=wdts-ai-cons-kv
RG=wdts-ai-program-console-rg
APP=wdts-ai-program-console

az keyvault secret set --vault-name "$VAULT" \
  --name USAGE-INGEST-HMAC-SECRET --value '<same-secret-the-forwarder-uses>'

az webapp config appsettings set --resource-group "$RG" --name "$APP" \
  --settings "USAGE_INGEST_HMAC_SECRET=@Microsoft.KeyVault(SecretUri=https://${VAULT}.vault.azure.net/secrets/USAGE-INGEST-HMAC-SECRET/)"

az webapp restart --resource-group "$RG" --name "$APP"
```

Contract and smoke test: [`docs/gateway-and-litellm.md`](../gateway-and-litellm.md).

---

## 4. Wire GitHub Actions OIDC

This is what replaces the `deploy-azure.sh` "client secret in a script"
pattern from the increment apps.

1. **Service principal** for the deploy:
   ```bash
   az ad sp create-for-rbac \
     --name "github-deploy-wdts-ai-program-console" \
     --role contributor \
     --scopes "/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}" \
     --json-auth
   ```
   Take the `clientId`, `tenantId`, and `subscriptionId` from the
   output. Discard `clientSecret` — we never use it. **Do not** store
   the JSON anywhere.

2. **Federated credential** scoped to the GitHub `production`
   environment on this repo:
   ```bash
   APP_OBJECT_ID=$(az ad app show --id <clientId> --query id -o tsv)

   az ad app federated-credential create \
     --id "$APP_OBJECT_ID" \
     --parameters '{
       "name": "github-prod-environment",
       "issuer": "https://token.actions.githubusercontent.com",
       "subject": "repo:agoyalwdts/wdts-ai-program-console:environment:production",
       "audiences": ["api://AzureADTokenExchange"]
     }'
   ```
   The `subject` line is the security boundary — only workflows running
   in the `production` GitHub environment can trade their OIDC token
   for a token to this SP.

3. **GitHub repo settings:**
   - Settings → Environments → **New environment** → `production`.
     - Required reviewers: at least one human (per `AGENTS.md` §10 N4).
     - Deployment branches: only `main`.
   - Add three **environment secrets** (not repository secrets — they
     scope to `production` only):
     - `AZURE_CLIENT_ID` — the SP's `clientId`.
     - `AZURE_TENANT_ID` — `tenantId`.
     - `AZURE_SUBSCRIPTION_ID` — `subscriptionId`.

4. **Promote the workflow:**
   ```bash
   cp docs/deploy/deploy.yml.sample .github/workflows/deploy.yml
   git add .github/workflows/deploy.yml
   git commit -m "ci: enable production deploy workflow"
   ```
   The first push to `main` after this triggers a deploy that needs
   manual approval before it actually runs `az` against production.

---

## 5. Verify

After the first successful deploy:

- [ ] `https://<app-name>.azurewebsites.net` returns the dashboard
  sign-in page.
- [ ] Sign-in with a WDTS account succeeds. JWT contains a `groups`
  claim (decode at <https://jwt.io> — JWT only, not the Auth.js
  session cookie).
- [ ] `/settings` probe page reports each integration as `real` and
  shows green for the ones whose tokens are populated.
- [ ] App Service → Diagnose and solve problems → no failed Key Vault
  reference resolutions.
- [ ] Postgres → no public network access listed under "Networking".
- [ ] `npm run reconcile:azuread:dry` (run from a workstation pointing
  at prod via tunnel) returns the expected user diff. Don't run the
  non-dry version until you've inspected the dry-run output.

---

## 7. Operational notes from the first preview deploy

Captured live from the 2026-04-28 v0.2 preview rollout. These are the
gotchas a future operator will hit if they don't read first.

### v0.2 preview deviations from LDR 0003

Two intentional deviations live behind the bootstrap script's defaults:

| LDR 0003 target | v0.2 preview reality | Why | Bootstrap flag |
|---|---|---|---|
| Key Vault in **RBAC** mode (`--enable-rbac-authorization true`), with `Key Vault Secrets User` on the managed identity | Key Vault in **access-policy** mode, with `set-policy` granting `get,list` to the managed identity and `get,list,set,delete` to the operator | The operator's `Contributor` role on the RG does not include `Microsoft.Authorization/roleAssignments/write`, which RBAC role-assignment-on-vault needs. Switching from access-policy to RBAC after creation needs the same permission, so this is a one-shot decision at create time | `KV_AUTH_MODE=rbac` once the operator has Owner / User Access Administrator |
| Postgres with **`--public-access Disabled`** + VNet integration + private endpoint | Postgres with **`--public-access Enabled`** + two firewall rules (allow-Azure-services + operator IP) | We don't yet have a subnet for the App Service, and `az webapp vnet-integration add` needs that before public access can be turned off without losing reachability | `PG_PUBLIC_ACCESS=Disabled` once the VNet + private endpoint story is built |

Both upgrades land in v0.3 alongside the custom domain. Until then, the
preview is closed-over-HTTPS but not network-isolated. Don't promote
this exact shape to "production" — promote it to "preview" and run the
v0.3 hardening pass before flipping any vendor `INTEGRATION_*=real`.

### Diagnosing the live deploy

App Service exposes a few toggles that are off by default and stay off
in steady state. Turn them **on** when something's broken, **off** when
you're done:

| Toggle | Effect | Why default off |
|---|---|---|
| `AUTH_DEBUG=true` (App Setting) | Auth.js logs the full sign-in flow including PKCE state, `account.access_token`, `id_token`, `profile`, and (on error) the underlying error class — `MissingSecret` / `InvalidCheck` / `OAuthCallbackError` etc. — which all map to the generic `error=Configuration` page in the UI | Debug logs include OAuth tokens. Treat the captured stream as a credential. |
| Kudu basic-auth publishing creds | Lets you POST to `/api/command` and read `/api/logstream/application` over HTTPS Basic with the publishing user/pass | Long-lived static creds; rotate or disable when not in use |
| `az webapp ssh` | Interactive shell into the running container | Same risk profile as the toggle above |

Useful one-liners (run with `az login`):

```bash
# Live application stream (needs Kudu basic auth on first)
az resource update -g <rg> -n scm --namespace Microsoft.Web \
  --resource-type basicPublishingCredentialsPolicies \
  --parent sites/<app> --set properties.allow=true
PASS=$(az webapp deployment list-publishing-credentials \
  -g <rg> -n <app> --query publishingPassword -o tsv)
curl -sS --no-buffer -u "\$<app>:$PASS" \
  "https://<app>.scm.azurewebsites.net/api/logstream/application"

# Verify Key Vault references actually resolved
az rest --method get --uri "https://management.azure.com/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Web/sites/<app>/config/configreferences/appsettings?api-version=2023-01-01"

# Probe runtime env from inside the container (env names only, values redacted)
curl -sS -u "\$<app>:$PASS" \
  -X POST "https://<app>.scm.azurewebsites.net/api/command" \
  -H "Content-Type: application/json" \
  -d '{"command":"sh -c \"printenv | cut -d= -f1 | sort\"","dir":"site"}'
```

When you're done: turn `AUTH_DEBUG` back to `false`, set
`basicPublishingCredentialsPolicies.allow=false`, and shred any local
log files you captured — they may contain Bearer tokens.

### Sign-in failure mode that is *not* a config bug

If a user reports `/api/auth/error?error=Configuration` immediately
after a fresh deploy, before assuming the AAD app or the Key Vault
references are wrong, check whether the user retried with stale
cookies. Auth.js encrypts the PKCE verifier with `AUTH_SECRET`; a
restart that doesn't change `AUTH_SECRET` is fine, but an in-flight
sign-in that started on the *previous* container is finished by the
*new* one with a now-undecryptable cookie → `InvalidCheck`. The fix is
"clear cookies for the host and retry." The same Configuration error
also covers `OAuthCallbackError: invalid_grant`, which is just a
single-use OAuth code being replayed — usually because the user hit
back/refresh on the callback URL.

### Browser-level Safe Browsing flag on `*.azurewebsites.net`

Chrome's Safe Browsing has an anti-phishing heuristic that flags any
`<thing>.azurewebsites.net/api/auth/signin/microsoft-entra-id` URL
because the host claims "azure" and the path claims "microsoft sign-in"
but the hostname is not a Microsoft domain. The user-facing fix is the
v0.3 custom-domain item; the workaround is "Hide details → this unsafe
site" per browser profile, or submit a reclassification request at
<https://safebrowsing.google.com/safebrowsing/report_error/>.

### Schema migrations that add seed data (RBAC, etc.)

`prisma db seed` is **destructive** by design — it `deleteMany`s users,
licenses, usage records and decisions to regenerate a deterministic
synthetic dataset. That's fine in local dev and CI. It is **not** OK to
run against a live preview / production database.

When a migration adds new tables or rows that need to exist for the app
to boot (e.g. the v0.3 RBAC migration: a `Role` table whose contents
the auth callback reads on every sign-in), the deploy sequence is:

```bash
# 1) Apply the migration (additive DDL only — no data writes).
DATABASE_URL="$(az keyvault secret show --vault-name wdts-ai-cons-kv \
  --name DATABASE-URL --query value -o tsv)" \
  npx prisma migrate deploy

# 2) Run the matching non-destructive deploy script.
DATABASE_URL="$(az keyvault secret show --vault-name wdts-ai-cons-kv \
  --name DATABASE-URL --query value -o tsv)" \
  npx tsx scripts/rbac-deploy.ts
```

The convention: every schema change that introduces seed-shaped data
ships with a `scripts/<feature>-deploy.ts` companion that is
idempotent, never deletes, and only touches the tables that feature
owns. Today there's one — `scripts/rbac-deploy.ts`, which:

- Upserts the four built-in `Role` rows (USER / MANAGER / FINOPS / ADMIN)
  from `lib/rbac/built-in-roles.ts`. Re-syncs `permissions[]` if a
  newer build changed the catalogue.
- Ensures the dashboard owner row exists with `isOwner=true`,
  `title="Chief Technology Officer · Head of AI Task Force"`, and
  `dashboardRoleId → ADMIN`.
- Backfills `User.dashboardRoleId = USER` for any pre-existing rows
  the migration left as `NULL` (so existing seed users continue to
  authorise).

It is safe to re-run on every deploy. It does **not** require a temp
firewall rule beyond the laptop IP needed for `migrate deploy` itself,
because it speaks the same Postgres connection string.

The local laptop firewall rule the operator added in step 1 should be
removed after step 2:

```bash
az postgres flexible-server firewall-rule delete \
  --resource-group wdts-ai-program-console-rg \
  --name wdts-ai-program-console-db \
  --rule-name "deploy-laptop-$(date +%Y%m%d)" --yes
```

When the GitHub Actions OIDC pipeline is wired (§4), both `migrate
deploy` and `scripts/<feature>-deploy.ts` move into the workflow and
run from a private agent that's already inside the VNet. Until then,
this is a manual step the operator runs from a workstation.

### Cron triggers (`/api/cron/*`)

`INTEGRATION_AZUREAD=real` is on in prod. The local `User` mirror drifts
from Entra every minute nobody runs the reconciler. v0.3 ships an
HMAC-protected cron endpoint so an external scheduler can drive it
without anyone holding a DB credential.

**Closed-by-default:** new rows the reconciler **creates** for Entra
users who were not already in Prisma are written with
`disabled=true` and no `dashboardRoleId` — they are **identity mirror
only** until an ADMIN uses **Invite user** (same email), which upgrades
the row to `disabled=false` + role. Cron can therefore never widen the
sign-in surface the way an apply-mode run against a full tenant would
if creates defaulted to enabled.

**Setup (once):**

1. Generate a shared secret on your laptop:

   ```bash
   openssl rand -hex 32
   ```

2. Store it in Key Vault and wire it into App Service as a Key Vault
   reference, same shape as the other secrets:

   ```bash
   az keyvault secret set \
     --vault-name wdts-ai-cons-kv \
     --name CRON-SHARED-SECRET \
     --value '<the-hex-string>'

   az webapp config appsettings set \
     --resource-group wdts-ai-program-console-rg \
     --name wdts-ai-program-console \
     --settings 'CRON_SHARED_SECRET=@Microsoft.KeyVault(SecretUri=https://wdts-ai-cons-kv.vault.azure.net/secrets/CRON-SHARED-SECRET/)'
   ```

3. Restart the App Service so the new env var lands.

When `CRON_SHARED_SECRET` is unset the route fails closed with `503` —
matches the Deel webhook pattern.

**Triggering a run (any of these works):**

- **GitHub Actions schedule** (recommended for v0.3 — no new
  infrastructure):

  ```yaml
  # .github/workflows/cron-reconcile-azuread.yml
  on:
    schedule:
      - cron: '17 14 * * *'  # 14:17 UTC daily — picked off-the-hour
                              # to avoid the 0-minute thundering herd
                              # on Microsoft Graph
    workflow_dispatch:        # let operators trigger ad-hoc

  jobs:
    poke:
      runs-on: ubuntu-latest
      steps:
        - name: POST cron trigger
          env:
            CRON_SECRET: ${{ secrets.CRON_SHARED_SECRET }}
          run: |
            BODY='{}'
            SIG=$(printf '%s' "$BODY" \
              | openssl dgst -sha256 -hmac "$CRON_SECRET" \
              | awk '{print $2}')
            curl -fsS -X POST \
              -H "x-cron-signature: sha256=${SIG}" \
              -H "content-type: application/json" \
              --data "$BODY" \
              https://wdts-ai-program-console.azurewebsites.net/api/cron/reconcile-azuread
  ```

  The repo secret `CRON_SHARED_SECRET` must match the App Service
  setting. No DB credential leaves Azure.

- **Azure Logic Apps / Azure Functions Timer.** Both fine; gives
  in-VNet execution if you go that route later.

- **External uptime checker (Pingdom, UptimeRobot, healthchecks.io).**
  Not recommended for production since most don't sign request bodies,
  but they work for ad-hoc / staging environments — call the URL
  unsigned and accept the `401`.

**Manual run (from operator laptop):**

```bash
SECRET="$(az keyvault secret show --vault-name wdts-ai-cons-kv \
  --name CRON-SHARED-SECRET --query value -o tsv)"
BODY='{"dryRun":true}'   # or '{}' for apply mode
SIG=$(printf '%s' "$BODY" \
  | openssl dgst -sha256 -hmac "$SECRET" \
  | awk '{print $2}')
curl -fsS -X POST \
  -H "x-cron-signature: sha256=${SIG}" \
  -H "content-type: application/json" \
  --data "$BODY" \
  https://wdts-ai-program-console.azurewebsites.net/api/cron/reconcile-azuread \
  | jq .
```

The response includes the `ReconcilerSummary` (created / updated /
suspended / mgr-linked / mgr-cleared / mgr-unresolved counts).

### Build conventions the deploy assumes

Both checked into the repo, both required for a working App Service
Linux deploy:

- `next.config.ts` → `output: "standalone"`. Without this the deploy
  bundle ships the entire `node_modules/`, slowing zip-deploy from
  ~30 s to a few minutes and risking timeouts on B-tier plans.
- `prisma/schema.prisma` → `binaryTargets = ["native", "debian-openssl-3.0.x"]`.
  Without the second target, `prisma generate` on a Mac doesn't emit
  a Linux Prisma engine, and the App Service container 500s on first
  query.

---

## 8. Things this runbook deliberately does not do

- **Custom domain / TLS.** v0.3 follow-up. `*.azurewebsites.net` is
  enough for v0.2 dev preview.
- **Front Door / WAF.** Add only when geo-blocking or WAF rules are
  on the requirements list. Not needed for an internal tool.
- **Multi-region / DR.** Single region. The failure mode is "30 min
  outage during a regional incident", which is acceptable.
- **Application Insights.** Not blocking the deploy; pick a
  destination (App Insights vs Log Analytics vs gateway log
  destination) and write a separate ADR before wiring it.
- **Secret rotation cadence.** Pick one when the prod app
  registration is live. Default suggestion: 90 days for vendor
  tokens, 24 months for Entra ID client secrets, on-rotation-only
  for `AUTH_SECRET` (rotation logs everyone out).
- **Auto-runnable script.** This entire runbook stays in
  `docs/deploy/`, not `.github/workflows/`, until a human reviewer
  copies the sample workflow into place. The bootstrap script never
  becomes auto-runnable.
