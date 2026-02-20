#!/usr/bin/env bash
# quick-curl-matrix.sh
# Usage:
#   export BASE_URL="https://www.flyrpro.app"
#   export ACCESS_TOKEN="<real user token>"
#   bash quick-curl-matrix.sh

set -euo pipefail
BASE_URL="${BASE_URL:-https://www.flyrpro.app}"
HANDOFF_URL="${BASE_URL%/}/api/auth/handoff"

echo "A) No token (expect 401 + x-matched-path: /api/auth/handoff)"
curl -sS -i -X POST "$HANDOFF_URL" | sed -n '1,25p'
echo

echo "B) With token (expect 200 + code/expires_at)"
curl -sS -i -X POST "$HANDOFF_URL" \
  -H "Authorization: Bearer ${ACCESS_TOKEN:-}" \
  -H "Content-Type: application/json" | sed -n '1,40p'
echo

echo "Interpretation:"
echo "- 401 + x-matched-path /api/auth/handoff => route is live, auth/token issue."
echo "- 405 + x-matched-path /404 => wrong deployment/route missing."
echo "- 500 => backend env/db issue (service role/table/jwt secret)."
