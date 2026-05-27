#!/usr/bin/env bash
# Enable Microsoft Graph outbound mail on prod App Service.
# Prerequisites: shared mailbox exists, Mail.Send consented on prod app reg,
# Exchange application access policy (M365 admin).
#
# Usage: ./scripts/wire-graph-mail-prod.sh ai-alerts@wdtablesystems.com

set -euo pipefail

SENDER="${1:?Usage: $0 <mailbox-upn> e.g. ai-alerts@wdtablesystems.com}"
RG=wdts-ai-program-console-rg
APP=wdts-ai-program-console
APP_ID=c71fbd12-105c-4566-bd8e-90bbc41fc0f2
MAIL_SEND_ROLE=e1bb9a0d-278-4f63-9442-d8fe427db8c3

echo "Adding Mail.Send to app registration (idempotent if already present)..."
az ad app permission add --id "$APP_ID" \
  --api 00000003-0000-0000-c000-000000000000 \
  --api-permissions "${MAIL_SEND_ROLE}=Role" 2>/dev/null || true

SP_OID=$(az ad sp show --id "$APP_ID" --query id -o tsv)
GRAPH_OID=$(az ad sp show --id 00000003-0000-0000-c000-000000000000 --query id -o tsv)
az rest --method POST \
  --uri "https://graph.microsoft.com/v1.0/servicePrincipals/${SP_OID}/appRoleAssignments" \
  --headers "Content-Type=application/json" \
  --body "{\"principalId\":\"${SP_OID}\",\"resourceId\":\"${GRAPH_OID}\",\"appRoleId\":\"${MAIL_SEND_ROLE}\"}" \
  2>/dev/null || echo "(Mail.Send assignment may already exist)"

echo "Setting App Service mail env..."
az webapp config appsettings set --resource-group "$RG" --name "$APP" \
  --settings \
  "EMAIL_PROVIDER=graph" \
  "GRAPH_MAIL_SENDER=${SENDER}" \
  "USER_MODEL_COACHING_EMAIL=1" \
  "APP_ENV=prod" \
  -o none

az webapp restart --resource-group "$RG" --name "$APP" -o none
echo "Done. Configure Exchange application access policy for ${SENDER}, then verify hourly cron-guardrail-monitor."
