#!/usr/bin/env bash
CAMPAIGN_ID="${1}"
SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"

if [ -z "$CAMPAIGN_ID" ]; then
  echo "Usage: ./invoke-blender-export.sh <campaign_id>"
  exit 1
fi

curl -X POST \
  "${SUPABASE_URL}/functions/v1/generate-blender-export" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"campaign_id\": \"${CAMPAIGN_ID}\", \"padding_meters\": 50}" | jq .
