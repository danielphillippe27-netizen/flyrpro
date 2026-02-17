#!/bin/bash
# One-liner to extract all US roads & divisions
# Just run: ./extract_us_remaining.sh

cd "$(dirname "$0")"

SSD_PATH="${SSD_PATH:-/Volumes/Untitled 2/na_extract.db}"

echo "Extracting US Roads & Divisions..."
echo "SSD: $SSD_PATH"
echo ""

# All US states + DC
for state in AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC; do
  echo "📍 $state"
  AWS_PROFILE=deploy python3 extract_overture_na.py \
    --themes roads divisions \
    --regions "$state" \
    --ssd-path "$SSD_PATH" \
    2>&1 | tail -1
done

echo ""
echo "✅ Done!"
