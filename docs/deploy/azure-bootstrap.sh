#!/usr/bin/env bash
# ============================================================================
# Azure bootstrap — wdts-ai-program-console
#
# DRAFT / sample. Run by hand on a workstation that's `az login`-ed against
# the WDTS-corp Azure subscription. Read every line before running. This
# script is the source-of-truth for the production resource shape; promoting
# it into a CI/CD pipeline is intentionally a separate decision.
#
# Authority for the choices made here: docs/decisions/0003-deploy-target.md.
# Walkthrough + verification checklist: docs/deploy/azure.md.
#
# What this script does (and only this):
#   1. Resource group
#   2. App Service Plan (Linux, B2)
#   3. Web app (Node 20, port 3000, https-only)
#   4. Postgres Flexible Server (PG16, B1ms, public access disabled)
#   5. Key Vault + every secret the app reads
#   6. System-assigned managed identity on the web app, granted
#      Key Vault Secrets User
#   7. App Settings wired as Key Vault references
#
# What this script does NOT do:
#   - Create the Microsoft Entra ID app registration. That's the manual step
#     in §2 of the runbook (admin consent has to be granted by a privileged
#     human anyway).
#   - Deploy code. That's GitHub Actions OIDC, see §4 of the runbook.
#   - Set up the federated credential / GitHub environment. See §4.
# ============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Parameters — edit these before running.
# ---------------------------------------------------------------------------
SUBSCRIPTION_ID="${SUBSCRIPTION_ID:-}"          # `az account show --query id -o tsv`
RESOURCE_GROUP="${RESOURCE_GROUP:-wdts-ai-program-console-rg}"
LOCATION="${LOCATION:-centralindia}"            # or `eastus` per LDR 0003
APP_NAME="${APP_NAME:-wdts-ai-program-console}"
PLAN_NAME="${PLAN_NAME:-${APP_NAME}-plan}"
PLAN_SKU="${PLAN_SKU:-B2}"                      # see LDR 0003 rationale
PG_NAME="${PG_NAME:-${APP_NAME}-db}"
PG_SKU="${PG_SKU:-Standard_B1ms}"
PG_VERSION="${PG_VERSION:-16}"
PG_DB_NAME="${PG_DB_NAME:-wdts_ai_program_console}"
PG_ADMIN_USER="${PG_ADMIN_USER:-wdtsadmin}"
KV_NAME="${KV_NAME:-${APP_NAME}-kv}"            # globally unique; tweak on collision

if [[ -z "$SUBSCRIPTION_ID" ]]; then
  echo "SUBSCRIPTION_ID is required. Run \`az account show --query id -o tsv\` and export it."
  exit 1
fi

if [[ "$LOCATION" == "australiaeast" ]]; then
  echo "LOCATION=australiaeast is excluded by LDR 0003. Pick centralindia or eastus."
  exit 1
fi

echo "About to operate on subscription $SUBSCRIPTION_ID, RG $RESOURCE_GROUP, region $LOCATION."
echo "Web app: $APP_NAME / Plan: $PLAN_NAME ($PLAN_SKU) / DB: $PG_NAME / Vault: $KV_NAME"
read -r -p "Continue? [y/N] " confirm
[[ "$confirm" == "y" || "$confirm" == "Y" ]] || { echo "Aborting."; exit 1; }

az account set --subscription "$SUBSCRIPTION_ID"

# ---------------------------------------------------------------------------
# 1. Resource group
# ---------------------------------------------------------------------------
echo "==> Resource group"
az group show --name "$RESOURCE_GROUP" >/dev/null 2>&1 \
  || az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

# ---------------------------------------------------------------------------
# 2. App Service Plan (Linux)
# ---------------------------------------------------------------------------
echo "==> App Service Plan"
az appservice plan show --name "$PLAN_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1 \
  || az appservice plan create \
       --name "$PLAN_NAME" \
       --resource-group "$RESOURCE_GROUP" \
       --location "$LOCATION" \
       --sku "$PLAN_SKU" \
       --is-linux \
       --output none

# ---------------------------------------------------------------------------
# 3. Web app (Node 20, https-only)
# ---------------------------------------------------------------------------
echo "==> Web app"
az webapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1 \
  || az webapp create \
       --name "$APP_NAME" \
       --resource-group "$RESOURCE_GROUP" \
       --plan "$PLAN_NAME" \
       --runtime "NODE:20-lts" \
       --https-only true \
       --output none

# Startup command + non-secret App Settings.
# Key-Vault-backed settings are wired in step 7.
az webapp config set \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --startup-file "node server.js" \
  --output none

az webapp config appsettings set \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --settings \
    WEBSITES_PORT=3000 \
    NODE_ENV=production \
    AUTH_TRUST_HOST=true \
    AUTH_URL="https://${APP_NAME}.azurewebsites.net" \
    INTEGRATION_AZUREAD=real \
    INTEGRATION_CURSOR=real \
    INTEGRATION_OPENAI=real \
    INTEGRATION_ANTHROPIC=real \
    INTEGRATION_M365GRAPH=real \
    INTEGRATION_DEEL=real \
    INTEGRATION_POLICYREPO=synthetic \
    POLICYREPO_OWNER=agoyalwdts \
    POLICYREPO_NAME=wdts-ai-policy \
    POLICYREPO_DEFAULT_BRANCH=main \
  --output none

# Enable system-assigned managed identity. We'll grant it Key Vault access in step 6.
PRINCIPAL_ID=$(
  az webapp identity assign \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query principalId -o tsv
)

# ---------------------------------------------------------------------------
# 4. Postgres Flexible Server (PG16, B1ms, public access disabled)
# ---------------------------------------------------------------------------
echo "==> Postgres Flexible Server"
PG_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)

if ! az postgres flexible-server show --name "$PG_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  az postgres flexible-server create \
    --name "$PG_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --tier Burstable \
    --sku-name "$PG_SKU" \
    --version "$PG_VERSION" \
    --admin-user "$PG_ADMIN_USER" \
    --admin-password "$PG_PASSWORD" \
    --public-access Disabled \
    --storage-size 32 \
    --high-availability Disabled \
    --backup-retention 7 \
    --output none

  az postgres flexible-server db create \
    --server-name "$PG_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --database-name "$PG_DB_NAME" \
    --output none
else
  # Server already exists; we no longer have the password. Caller must have
  # stored it in Key Vault on first run. Skip rather than rotate silently.
  PG_PASSWORD=""
fi

# ---------------------------------------------------------------------------
# 5. Key Vault
# ---------------------------------------------------------------------------
echo "==> Key Vault"
az keyvault show --name "$KV_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1 \
  || az keyvault create \
       --name "$KV_NAME" \
       --resource-group "$RESOURCE_GROUP" \
       --location "$LOCATION" \
       --enable-rbac-authorization true \
       --retention-days 90 \
       --output none

# ---------------------------------------------------------------------------
# 6. Grant the web app's managed identity Key Vault Secrets User
# ---------------------------------------------------------------------------
echo "==> Managed identity → Key Vault role assignment"
KV_ID=$(az keyvault show --name "$KV_NAME" --resource-group "$RESOURCE_GROUP" --query id -o tsv)
az role assignment create \
  --assignee-object-id "$PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" \
  --scope "$KV_ID" \
  --output none 2>/dev/null || true   # idempotent: ignore "already exists"

# ---------------------------------------------------------------------------
# 7. Seed Key Vault secrets + wire App Settings as Key Vault refs
#
# Most secrets are placeholders the human operator fills in by hand
# afterwards (see runbook §3). The DATABASE-URL is the one secret this
# script can construct itself, and only on first creation of the PG server.
# ---------------------------------------------------------------------------
echo "==> Key Vault secrets (placeholders)"

set_kv_placeholder() {
  local name="$1"
  if ! az keyvault secret show --vault-name "$KV_NAME" --name "$name" >/dev/null 2>&1; then
    az keyvault secret set \
      --vault-name "$KV_NAME" \
      --name "$name" \
      --value "PLACEHOLDER-${name}" \
      --output none
  fi
}

KV_SECRETS=(
  AZURE-AD-TENANT-ID
  AZURE-AD-CLIENT-ID
  AZURE-AD-CLIENT-SECRET
  AUTH-SECRET
  POLICYREPO-TOKEN
  OPENAI-ADMIN-API-KEY
  OPENAI-ORG-ID
  ANTHROPIC-ADMIN-API-KEY
  ANTHROPIC-ORG-ID
  ANTHROPIC-WORKSPACE-ID
  AZURE-OPENAI-ENDPOINT
  AZURE-OPENAI-API-KEY
  CURSOR-SCIM-BASE-URL
  CURSOR-ADMIN-TOKEN
  DEEL-API-TOKEN
  DEEL-WEBHOOK-SECRET
)
for s in "${KV_SECRETS[@]}"; do
  set_kv_placeholder "$s"
done

if [[ -n "$PG_PASSWORD" ]]; then
  PG_HOST="${PG_NAME}.postgres.database.azure.com"
  DATABASE_URL="postgresql://${PG_ADMIN_USER}:${PG_PASSWORD}@${PG_HOST}:5432/${PG_DB_NAME}?sslmode=require"
  az keyvault secret set \
    --vault-name "$KV_NAME" \
    --name DATABASE-URL \
    --value "$DATABASE_URL" \
    --output none
  echo "    Stored DATABASE-URL in Key Vault. The plaintext password is not echoed anywhere."
else
  echo "    Postgres server pre-existed; not overwriting DATABASE-URL. If the secret"
  echo "    is missing, set it by hand from a known good password (rotate via az postgres"
  echo "    flexible-server update --admin-password and re-store in Key Vault)."
fi

echo "==> App Settings → Key Vault references"

kv_ref() {
  local name="$1"
  echo "@Microsoft.KeyVault(SecretUri=https://${KV_NAME}.vault.azure.net/secrets/${name}/)"
}

az webapp config appsettings set \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --settings \
    AZURE_AD_TENANT_ID="$(kv_ref AZURE-AD-TENANT-ID)" \
    AZURE_AD_CLIENT_ID="$(kv_ref AZURE-AD-CLIENT-ID)" \
    AZURE_AD_CLIENT_SECRET="$(kv_ref AZURE-AD-CLIENT-SECRET)" \
    AUTH_SECRET="$(kv_ref AUTH-SECRET)" \
    DATABASE_URL="$(kv_ref DATABASE-URL)" \
    POLICYREPO_TOKEN="$(kv_ref POLICYREPO-TOKEN)" \
    OPENAI_ADMIN_API_KEY="$(kv_ref OPENAI-ADMIN-API-KEY)" \
    OPENAI_ORG_ID="$(kv_ref OPENAI-ORG-ID)" \
    ANTHROPIC_ADMIN_API_KEY="$(kv_ref ANTHROPIC-ADMIN-API-KEY)" \
    ANTHROPIC_ORG_ID="$(kv_ref ANTHROPIC-ORG-ID)" \
    ANTHROPIC_WORKSPACE_ID="$(kv_ref ANTHROPIC-WORKSPACE-ID)" \
    AZURE_OPENAI_ENDPOINT="$(kv_ref AZURE-OPENAI-ENDPOINT)" \
    AZURE_OPENAI_API_KEY="$(kv_ref AZURE-OPENAI-API-KEY)" \
    CURSOR_SCIM_BASE_URL="$(kv_ref CURSOR-SCIM-BASE-URL)" \
    CURSOR_ADMIN_TOKEN="$(kv_ref CURSOR-ADMIN-TOKEN)" \
    DEEL_API_TOKEN="$(kv_ref DEEL-API-TOKEN)" \
    DEEL_WEBHOOK_SECRET="$(kv_ref DEEL-WEBHOOK-SECRET)" \
  --output none

# ---------------------------------------------------------------------------
# Done.
# ---------------------------------------------------------------------------
cat <<EOF

Bootstrap complete.

Next steps (manual; see docs/deploy/azure.md):
  - Runbook §2: create the *production* Microsoft Entra ID app registration
    and store its tenant id, client id, and client secret in Key Vault under
    AZURE-AD-TENANT-ID / AZURE-AD-CLIENT-ID / AZURE-AD-CLIENT-SECRET
    (overwriting the placeholders this script seeded).
  - Runbook §3: replace the remaining PLACEHOLDER-* values in Key Vault with
    real vendor tokens, one secret at a time.
  - Runbook §4: create the deploy SP, the federated credential, and the
    GitHub 'production' environment, then promote
    docs/deploy/deploy.yml.sample → .github/workflows/deploy.yml.
EOF
