# Canada Extraction Guide - FLYR PRO

## Current Status

### What's Already in S3 (Completed)
| Theme | Regions | Count |
|-------|---------|-------|
| Buildings | US: 42 states + Canada: ON, PE | 44 regions |
| Roads | ON only | 1 region |
| Divisions | ON only | 1 region |

### What's Missing - CANADA (11 regions)
- **AB** - Alberta
- **BC** - British Columbia  
- **MB** - Manitoba
- **NB** - New Brunswick
- **NL** - Newfoundland and Labrador
- **NS** - Nova Scotia
- **NT** - Northwest Territories
- **NU** - Nunavut
- **QC** - Quebec
- **SK** - Saskatchewan
- **YT** - Yukon

---

## Prerequisites

1. **Reconnect External SSD**: Mount `/Volumes/Untitled 2/` (or wherever your `na_extract.db` is)
2. **Verify AWS Profile**: Ensure `AWS_PROFILE=deploy` is configured

---

## Quick Start - Extract All Missing Canada

### Option 1: Simple Sequential (Safest)
```bash
cd scripts

# Extract all missing Canadian regions (all themes)
./extract_canada_remaining.sh all

# Or extract specific theme only:
./extract_canada_remaining.sh buildings
./extract_canada_remaining.sh roads
./extract_canada_remaining.sh divisions
```

### Option 2: Parallel (Faster)
```bash
cd scripts

# Extract all themes for all Canada regions (2 workers)
python3 extract_canada_parallel.py --theme all --workers 2

# Extract just buildings (faster, can use more workers)
python3 extract_canada_parallel.py --theme buildings --workers 3

# Extract specific region only
python3 extract_canada_parallel.py --region BC --theme all
```

---

## Estimated Time & Cost

| Theme | Per Region | Total (11 regions) |
|-------|-----------|-------------------|
| Buildings | 15-30 min | 3-5 hours |
| Roads | 10-20 min | 2-3 hours |
| Divisions | 5-10 min | 1-2 hours |
| **All Themes** | **30-60 min** | **6-10 hours** |

**Storage**: ~500MB-2GB per region per theme (~5-10GB total for all Canada)

---

## Manual Region-by-Region (If Issues)

```bash
cd scripts

# Example: Extract Quebec buildings only
AWS_PROFILE=deploy python3 extract_overture_na.py \
    --themes buildings \
    --regions QC \
    --ssd-path "/Volumes/Untitled 2/na_extract.db"

# Example: Extract British Columbia all themes
AWS_PROFILE=deploy python3 extract_overture_na.py \
    --themes buildings roads divisions \
    --regions BC \
    --ssd-path "/Volumes/Untitled 2/na_extract.db"
```

---

## Verify Completion

After extraction, verify all regions are in S3:

```bash
# Check buildings
echo "Buildings:" && aws s3 ls s3://flyr-pro-addresses-2025/overture_extracts/buildings/release=2026-01-21.0/ | grep region | wc -l

# Check roads
echo "Roads:" && aws s3 ls s3://flyr-pro-addresses-2025/overture_extracts/roads/release=2026-01-21.0/ | grep region | wc -l

# Check divisions
echo "Divisions:" && aws s3 ls s3://flyr-pro-addresses-2025/overture_extracts/divisions/release=2026-01-21.0/ | grep region | wc -l
```

**Expected**: 55 regions for buildings (44 existing + 11 Canada), 12 regions for roads/divisions

---

## Resume After Crash

If extraction is interrupted:
1. The script will skip already-extracted data in S3 (checks before upload)
2. Simply re-run the same command - it will continue where it left off
3. Check S3 first to see which regions completed:
   ```bash
   aws s3 ls s3://flyr-pro-addresses-2025/overture_extracts/buildings/release=2026-01-21.0/ | grep region
   ```

---

## Post-Extraction: Update Lambda

Once Canada roads are extracted with class/subclass, the Lambda will automatically use the enhanced data for better street-side routing.

The Lambda code is already updated - just the data needs to be re-extracted.
