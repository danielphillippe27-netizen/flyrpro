#!/bin/bash
# Extract remaining Canadian regions for FLYR PRO
# Usage: ./extract_canada_remaining.sh [buildings|roads|divisions|all]

set -e

THEME=${1:-all}
SSD_PATH="${SSD_PATH:-/Volumes/Untitled 2/na_extract.db}"
RELEASE="2026-01-21.0"

# Canadian regions still missing (11 regions)
CANADA_REGIONS=("AB" "BC" "MB" "NB" "NL" "NS" "NT" "NU" "QC" "SK" "YT")

echo "=========================================="
echo "FLYR PRO - Canada Extraction"
echo "=========================================="
echo "Theme: $THEME"
echo "SSD Path: $SSD_PATH"
echo "Regions: ${#CANADA_REGIONS[@]} provinces/territories"
echo ""

# Function to extract a single region
extract_region() {
    local region=$1
    local theme=$2
    echo "📍 Extracting $region - $theme..."
    
    AWS_PROFILE=deploy python3 extract_overture_na.py \
        --themes "$theme" \
        --regions "$region" \
        --ssd-path "$SSD_PATH" \
        2>&1 | tail -5
}

# Extract based on theme
if [ "$THEME" == "all" ]; then
    THEMES=("buildings" "roads" "divisions")
else
    THEMES=("$THEME")
fi

for theme in "${THEMES[@]}"; do
    echo ""
    echo "🗂️  Processing theme: $theme"
    echo "------------------------------------------"
    
    for region in "${CANADA_REGIONS[@]}"; do
        extract_region "$region" "$theme"
    done
done

echo ""
echo "=========================================="
echo "✅ Canada extraction complete!"
echo "=========================================="
