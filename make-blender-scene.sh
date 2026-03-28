#!/usr/bin/env bash
set -e

CAMPAIGN_ID="${1}"
if [ -z "$CAMPAIGN_ID" ]; then
  echo "Usage: ./make-blender-scene.sh <campaign_id>"
  exit 1
fi

# Supabase credentials from .env.local
SUPABASE_URL="https://kfnsnwqylsdsbgnwgxva.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmbnNud3F5bHNkc2JnbndneHZhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDkyNjczMSwiZXhwIjoyMDc2NTAyNzMxfQ.DCCPBeHISbRcz4Z-tSaGvjszB-un0vvp45avmv9YPas"

# Output directory
EXPORT_DIR="./blender-exports/${CAMPAIGN_ID}"
mkdir -p "${EXPORT_DIR}"

echo "🎬 Invoking blender export for campaign: ${CAMPAIGN_ID}"

# Invoke the edge function
RESPONSE=$(curl -s -X POST \
  "${SUPABASE_URL}/functions/v1/generate-blender-export" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"campaign_id\": \"${CAMPAIGN_ID}\", \"padding_meters\": 50}")

# Check for errors
if echo "${RESPONSE}" | grep -q "error"; then
  echo "❌ Export failed:"
  echo "${RESPONSE}" | jq .
  exit 1
fi

echo "✅ Export completed successfully"
echo "${RESPONSE}" | jq .

# Extract signed URLs from the campaign_snapshots table or response
# The files are already uploaded to storage, let's download them
echo ""
echo "📥 Downloading exported files..."

# Get the signed URLs from the database
FILES=$(curl -s -X POST \
  "${SUPABASE_URL}/rest/v1/rpc/get_blender_export_urls" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"p_campaign_id\": \"${CAMPAIGN_ID}\"}" 2>/dev/null || echo "null")

# If RPC doesn't exist, try direct storage download
if [ "${FILES}" = "null" ] || [ -z "${FILES}" ]; then
  echo "Using direct storage download..."
  
  FILES_LIST=("boundary.geojson" "buildings.geojson" "roads.geojson" "addresses.geojson" "manifest.json")
  PREFIX="${CAMPAIGN_ID}/v1"
  
  for FILE in "${FILES_LIST[@]}"; do
    echo "  Downloading ${FILE}..."
    curl -s -X GET \
      "${SUPABASE_URL}/storage/v1/object/blender-exports/${PREFIX}/${FILE}" \
      -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
      -o "${EXPORT_DIR}/${FILE}" || echo "  ⚠️ Failed to download ${FILE}"
  done
else
  # Download using signed URLs
  echo "${FILES}" | jq -r '.[] | select(.signed_url != null) | "\(.path) \(.signed_url)"' | while read -r path url; do
    filename=$(basename "${path}")
    echo "  Downloading ${filename}..."
    curl -s -L "${url}" -o "${EXPORT_DIR}/${filename}" || echo "  ⚠️ Failed to download ${filename}"
  done
fi

echo ""
echo "📁 Files downloaded to: ${EXPORT_DIR}"
ls -la "${EXPORT_DIR}"

# Update the blender_importer.py with the correct path
echo ""
echo "📝 Updating blender_importer.py with export directory..."
sed -i.bak "s|EXPORT_DIR = \"/path/to/downloaded/export\"|EXPORT_DIR = \"${EXPORT_DIR}\"|" scripts/blender_importer.py
rm -f scripts/blender_importer.py.bak

echo ""
echo "✅ Done! Next steps:"
echo "   1. Open Blender"
echo "   2. Go to Scripting tab"
echo "   3. Open: scripts/blender_importer.py"
echo "   4. Click 'Run Script'"
echo ""
echo "   Export directory: ${EXPORT_DIR}"
