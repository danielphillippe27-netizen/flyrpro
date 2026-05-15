#!/usr/bin/env bash
# verify-handoff.sh
# Usage:
#   export BASE_URL="https://www.flyrpro.app"
#   export ACCESS_TOKEN="<real supabase user access token>"
#   bash verify-handoff.sh

set -euo pipefail

BASE_URL="${BASE_URL:-https://www.flyrpro.app}"
HANDOFF_URL="${BASE_URL%/}/api/auth/handoff"
REDEEM_URL="${BASE_URL%/}/api/auth/redeem-handoff"
TEAM_URL="${BASE_URL%/}/onboarding/team"

echo "== 1) Health check: route exists =="
curl -sS -i -X POST "$HANDOFF_URL" | sed -n '1,20p'
echo

if [[ -z "${ACCESS_TOKEN:-}" ]]; then
  echo "ACCESS_TOKEN is not set. Export a real user access token first."
  exit 1
fi

echo "== 2) Create handoff code =="
RESP="$(curl -sS -X POST "$HANDOFF_URL" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json")"

echo "Response: $RESP"

CODE="$(printf '%s' "$RESP" | python3 - <<'PY'
import json,sys
raw=sys.stdin.read().strip()
try:
    j=json.loads(raw)
    print(j.get("code",""))
except Exception:
    print("")
PY
)"

if [[ -z "$CODE" ]]; then
  echo "No code returned. Create step failed."
  exit 1
fi

echo "Got code: $CODE"
echo

echo "== 3) Redeem code API directly =="
curl -sS -i -X POST "$REDEEM_URL" \
  -H "Content-Type: application/json" \
  --data "{\"code\":\"$CODE\"}" | sed -n '1,40p'
echo

echo "== 4) Team URL with code (should redirect/establish session in browser) =="
echo "${TEAM_URL}?code=${CODE}"
