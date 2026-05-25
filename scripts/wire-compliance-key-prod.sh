#!/usr/bin/env bash
# Wire OpenAI Compliance API key into prod Key Vault + App Service.
# Run locally after OpenAI has enabled Compliance on the key.
# The key is read from stdin (not echoed).

set -euo pipefail

VAULT=wdts-ai-cons-kv
RG=wdts-ai-program-console-rg
APP=wdts-ai-program-console

if [[ -t 0 ]]; then
  read -r -s -p "Paste Compliance API key (platform_api_key), then Enter: " KEY
  echo
else
  KEY="${OPENAI_COMPLIANCE_API_KEY:-}"
fi

if [[ -z "${KEY}" ]]; then
  echo "No key provided. Set OPENAI_COMPLIANCE_API_KEY or run interactively." >&2
  exit 1
fi

az keyvault secret set --vault-name "$VAULT" \
  --name OPENAI-COMPLIANCE-API-KEY --value "$KEY" -o none

az webapp config appsettings set --resource-group "$RG" --name "$APP" \
  --settings \
  "OPENAI_COMPLIANCE_API_KEY=@Microsoft.KeyVault(SecretUri=https://${VAULT}.vault.azure.net/secrets/OPENAI-COMPLIANCE-API-KEY/)" \
  "INTEGRATION_OPENAI_COMPLIANCE=real" \
  -o none

az webapp restart --resource-group "$RG" --name "$APP" -o none

WS=$(az keyvault secret show --vault-name "$VAULT" --name CHATGPT-WORKSPACE-ID --query value -o tsv)
AFTER=$(date -u -v-7d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ)
HTTP=$(curl -sS -o /tmp/compliance-probe.json -w "%{http_code}" -G \
  -H "Authorization: Bearer ${KEY}" \
  "https://api.chatgpt.com/v1/compliance/workspaces/${WS}/logs" \
  --data-urlencode "event_type=AUTH_LOG" \
  --data-urlencode "limit=3" \
  --data-urlencode "after=${AFTER}")
unset KEY

echo "Compliance list logs: HTTP ${HTTP}"
if [[ "${HTTP}" == "200" ]]; then
  python3 -c "import json; d=json.load(open('/tmp/compliance-probe.json')); print('log_files', len(d.get('data',[])), 'has_more', d.get('has_more'))"
else
  head -c 300 /tmp/compliance-probe.json
  echo
fi
echo "Done. Check /users → Sign-in footprint → ChatGPT (Compliance AUTH_LOG) after ~1 min."
