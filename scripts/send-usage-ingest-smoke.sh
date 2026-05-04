#!/usr/bin/env bash
# Pilot smoke: POST one synthetic UsageRecord via /api/webhooks/usage-ingest.
#
# Usage:
#   export DASHBOARD_PUBLIC_BASE_URL='https://your-host.example'
#   export USAGE_INGEST_HMAC_SECRET='…'
#   export SMOKE_USER_EMAIL='existing-user@yourorg.com'
#   ./scripts/send-usage-ingest-smoke.sh
#
# Requires: curl, openssl, python3. User email must exist in Prisma User table.

set -euo pipefail

BASE="${DASHBOARD_PUBLIC_BASE_URL:-}"
SECRET="${USAGE_INGEST_HMAC_SECRET:-}"
EMAIL="${SMOKE_USER_EMAIL:-}"

if [[ -z "$BASE" || -z "$SECRET" || -z "$EMAIL" ]]; then
  echo "Set DASHBOARD_PUBLIC_BASE_URL, USAGE_INGEST_HMAC_SECRET, SMOKE_USER_EMAIL" >&2
  exit 1
fi

BASE="${BASE%/}"
URL="${BASE}/api/webhooks/usage-ingest"
SID="smoke-$(date +%s)-$$"
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

export SID EMAIL TS
BODY=$(python3 <<'PY'
import json, os
ev = {
    "sourceEventId": os.environ["SID"],
    "userEmail": os.environ["EMAIL"],
    "product": "CHATGPT",
    "model": "smoke-test",
    "tokensIn": 1,
    "tokensOut": 1,
    "costUsd": 0.0001,
    "decision": "ALLOWED",
    "region": "global",
    "ts": os.environ["TS"],
    "dlpLayersHit": [],
}
print(json.dumps({"events": [ev]}))
PY
)

SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

echo "POST $URL" >&2
curl -fsS -X POST "$URL" \
  -H "content-type: application/json" \
  -H "x-usage-ingest-signature: sha256=${SIG}" \
  --data "$BODY" | tee /dev/stderr
echo >&2
