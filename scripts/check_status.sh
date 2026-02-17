#!/bin/bash
# Check extraction status for all North America

echo "========================================"
echo "FLYR PRO - Extraction Status"
echo "========================================"
echo ""

RELEASE="2026-01-21.0"

# Count functions
count_buildings() { aws s3 ls s3://flyr-pro-addresses-2025/overture_extracts/buildings/release=$RELEASE/ 2>/dev/null | grep -c "region="; }
count_roads() { aws s3 ls s3://flyr-pro-addresses-2025/overture_extracts/roads/release=$RELEASE/ 2>/dev/null | grep -c "region="; }
count_divisions() { aws s3 ls s3://flyr-pro-addresses-2025/overture_extracts/divisions/release=$RELEASE/ 2>/dev/null | grep -c "region="; }

echo "📊 Current Status:"
echo "Buildings:  $(count_buildings)/64 regions"
echo "Roads:      $(count_roads)/64 regions"
echo "Divisions:  $(count_divisions)/64 regions"
echo ""

# Check US roads/divisions
echo "🇺🇸 US States - Roads & Divisions:"
US_MISSING_ROADS=""
US_MISSING_DIVS=""
for s in AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC; do
  if ! aws s3 ls "s3://flyr-pro-addresses-2025/overture_extracts/roads/release=$RELEASE/region=$s/" 2>/dev/null | grep -q tile_y; then
    US_MISSING_ROADS="$US_MISSING_ROADS $s"
  fi
  if ! aws s3 ls "s3://flyr-pro-addresses-2025/overture_extracts/divisions/release=$RELEASE/region=$s/" 2>/dev/null | grep -q tile_y; then
    US_MISSING_DIVS="$US_MISSING_DIVS $s"
  fi
done

ROADS_COUNT=$(echo "$US_MISSING_ROADS" | wc -w | xargs)
DIVS_COUNT=$(echo "$US_MISSING_DIVS" | wc -w | xargs)

echo "  Missing Roads: $ROADS_COUNT states"
echo "  Missing Divisions: $DIVS_COUNT states"
echo ""

# Check Canada
echo "🇨🇦 Canada Status:"
for r in AB BC MB NB NL NS NT NU ON PE QC SK YT; do
  B=$(aws s3 ls "s3://flyr-pro-addresses-2025/overture_extracts/buildings/release=$RELEASE/region=$r/" 2>/dev/null | head -1 | wc -l | xargs)
  R=$(aws s3 ls "s3://flyr-pro-addresses-2025/overture_extracts/roads/release=$RELEASE/region=$r/" 2>/dev/null | head -1 | wc -l | xargs)
  D=$(aws s3 ls "s3://flyr-pro-addresses-2025/overture_extracts/divisions/release=$RELEASE/region=$r/" 2>/dev/null | head -1 | wc -l | xargs)
  
  B_ICON=$([ "$B" = "1" ] && echo "✅" || echo "❌")
  R_ICON=$([ "$R" = "1" ] && echo "✅" || echo "❌")
  D_ICON=$([ "$D" = "1" ] && echo "✅" || echo "❌")
  
  printf "  %s: B=%s R=%s D=%s\n" "$r" "$B_ICON" "$R_ICON" "$D_ICON"
done

echo ""
STORAGE=$(aws s3 ls s3://flyr-pro-addresses-2025/overture_extracts/ --recursive 2>/dev/null | awk '{sum+=$3} END {printf "%.1f GB", sum/1024/1024/1024}')
echo "💾 Total Storage: $STORAGE"
