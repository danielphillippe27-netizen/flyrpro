# US Roads & Divisions Extraction Guide

## Current Status (As of Feb 17, 2026)

✅ **COMPLETED:**
- Buildings: 64 regions (100% - All US + Canada)
- Roads: 13 regions (Canada only)
- Divisions: 13 regions (Canada only)

⏳ **REMAINING:**
- Roads: 51 US regions
- Divisions: 51 US regions

---

## Quick Start

When you're ready to finish the extraction, run:

```bash
cd scripts

# Check current status first
./check_status.sh

# Run the extraction (4-6 hours)
./extract_us_roads_divisions.sh
```

---

## What Gets Extracted

| Theme | Current | Target | Remaining |
|-------|---------|--------|-----------|
| Buildings | 64 | 64 | ✅ Done |
| Roads | 13 | 64 | 51 US states |
| Divisions | 13 | 64 | 51 US states |

**Storage Impact:** +20-30 GB (estimated)

---

## Scripts Available

| Script | Purpose |
|--------|---------|
| `check_status.sh` | See what's already extracted |
| `extract_us_roads_divisions.sh` | Full extraction with progress tracking |
| `extract_us_remaining.sh` | Simple sequential extraction |

---

## Before You Start

1. **Mount External SSD**: Ensure `/Volumes/Untitled 2/` is connected
2. **Check AWS Profile**: Verify `AWS_PROFILE=deploy` works
3. **Check Status**: Run `./check_status.sh` to see current state

---

## During Extraction

The script will:
- Skip regions already extracted (checks S3 first)
- Show progress: `[23/51] CA: 🚀 Extracting...`
- Extract both roads and divisions per state
- Take 4-6 hours total

---

## After Extraction

Verify completion:
```bash
./check_status.sh
```

Expected:
- Roads: 64 regions
- Divisions: 64 regions
- Total Storage: ~75-85 GB

---

## Resume If Interrupted

Just re-run the script - it will skip already-extracted regions automatically.

---

## Troubleshooting

**SSD not found:**
```bash
# Check mount point
ls -la /Volumes/

# Update path if needed
SSD_PATH="/Volumes/YourDrive/na_extract.db" ./extract_us_roads_divisions.sh
```

**AWS credentials:**
```bash
aws sts get-caller-identity --profile deploy
```

**Check specific region:**
```bash
aws s3 ls s3://flyr-pro-addresses-2025/overture_extracts/roads/release=2026-01-21.0/region=CA/
```
