#!/usr/bin/env bash
# Verify POST /api/auth/handoff after deploying www.flyrpro.app.
# Usage:
#   ./scripts/verify-handoff-deploy.sh
#   TOKEN="your-jwt" ./scripts/verify-handoff-deploy.sh
#
# Expected success: HTTP 200, JSON { "code": "...", "expires_at": "..." }, no x-matched-path: /404

set -e
URL="${HANDOFF_URL:-https://www.flyrpro.app/api/auth/handoff}"
TOKEN="${TOKEN:-<token>}"

echo "→ POST $URL"
echo "  Authorization: Bearer ${TOKEN:0:20}..."
echo ""

resp=$(curl -s -i -X POST "$URL" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json") || true

echo "$resp"
echo ""

status=$(echo "$resp" | head -1)
match_path=$(echo "$resp" | grep -i "x-matched-path" || true)

if echo "$status" | grep -q " 200 "; then
  if echo "$resp" | grep -q '"code"'; then
    echo "✅ OK: 200 + JSON with code (handoff route is live)."
  else
    echo "⚠️  200 but response body may be missing code/expires_at — check JSON above."
  fi
elif [ -n "$match_path" ] && echo "$match_path" | grep -q "/404"; then
  echo "❌ Route not found: x-matched-path shows /404. Ensure app/api/auth/handoff/route.ts exists in deployed app and Root Directory is correct; redeploy."
else
  echo "❌ Unexpected response. Check status line and body above (e.g. 401 = bad token, 405 = routing/method issue)."
fi
