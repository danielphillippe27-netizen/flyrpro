#!/bin/bash
# Extract US Roads and Divisions for FLYR PRO
# Run this to complete the North America dataset
# Usage: ./extract_us_roads_divisions.sh

set -e

SSD_PATH="${SSD_PATH:-/Volumes/Untitled 2/na_extract.db}"
RELEASE="2026-01-21.0"

# All 51 US regions (50 states + DC)
US_REGIONS=(
  "AL" "AK" "AZ" "AR" "CA" "CO" "CT" "DE" "FL" "GA"
  "HI" "ID" "IL" "IN" "IA" "KS" "KY" "LA" "ME" "MD"
  "MA" "MI" "MN" "MS" "MO" "MT" "NE" "NV" "NH" "NJ"
  "NM" "NY" "NC" "ND" "OH" "OK" "OR" "PA" "RI" "SC"
  "SD" "TN" "TX" "UT" "VT" "VA" "WA" "WV" "WI" "WY"
  "DC"
)

echo "========================================"
echo "FLYR PRO - US Roads & Divisions"
echo "========================================"
echo "SSD Path: $SSD_PATH"
echo "Regions: ${#US_REGIONS[@]} US states + DC"
echo "Themes: roads, divisions"
echo ""
echo "⚠️  This will add ~20-30GB to S3"
echo "⏱️  Estimated time: 4-6 hours"
echo "========================================"
echo ""

# Check if SSD is mounted
if [ ! -f "$SSD_PATH" ]; then
  echo "❌ ERROR: SSD not found at $SSD_PATH"
  echo "Please mount your external drive and try again"
  exit 1
fi

echo "✅ SSD found"
echo ""

# Function to extract a single region
total=${#US_REGIONS[@]}
current=0

extract_region() {
  local region=$1
  current=$((current + 1))
  
  # Check if already exists in S3
  local roads_exists=$(aws s3 ls "s3://flyr-pro-addresses-2025/overture_extracts/roads/release=$RELEASE/region=$region/" 2>/dev/null | grep -c ".parquet" || echo "0")
  local divs_exists=$(aws s3 ls "s3://flyr-pro-addresses-2025/overture_extracts/divisions/release=$RELEASE/region=$region/" 2>/dev/null | grep -c ".parquet" || echo "0")
  
  if [ "$roads_exists" -gt 0 ] && [ "$divs_exists" -gt 0 ]; then
    echo "[$current/$total] $region: ⏭️  SKIP (already exists)"
    return 0
  fi
  
  echo "[$current/$total] $region: 🚀 Extracting..."
  
  AWS_PROFILE=deploy python3 extract_overture_na.py \
    --themes roads divisions \
    --regions "$region" \
    --ssd-path "$SSD_PATH" \
    2>&1 | grep -E "(rows|✅|error)" | tail -2
}

# Extract all regions
for region in "${US_REGIONS[@]}"; do
  extract_region "$region"
  echo ""
done

echo "========================================"
echo "✅ US EXTRACTION COMPLETE!"
echo "========================================"
echo ""
echo "Final Status:"
echo "Roads: $(aws s3 ls s3://flyr-pro-addresses-2025/overture_extracts/roads/release=$RELEASE/ 2>/dev/null | grep region | wc -l | xargs) regions"
echo "Divisions: $(aws s3 ls s3://flyr-pro-addresses-2025/overture_extracts/divisions/release=$RELEASE/ 2>/dev/null | grep region | wc -l | xargs) regions"
