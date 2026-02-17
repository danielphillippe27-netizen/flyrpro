# Snap to Roads - S3 Setup Guide

## Problem
The snap-to-roads feature needs road data. You have two options:

1. **Database** (current): Load roads into `overture_transportation` table
2. **S3** (new): Fetch roads from S3 GeoJSON file

## Option 1: Use S3 for Roads (Recommended)

### Step 1: Extract Ontario Roads to S3

If you have Overture road parquet files in S3:

```bash
export AWS_ACCESS_KEY_ID=xxx
export AWS_SECRET_ACCESS_KEY=xxx
npx tsx scripts/extract-ontario-roads-to-s3.ts
```

This creates:
```
s3://flyr-pro-addresses-2025/overture_extracts/roads/ontario/roads.geojson
```

### Step 2: Configure Environment

Add to your `.env.local`:

```bash
# Roads S3 Configuration
ROADS_S3_BUCKET=flyr-pro-addresses-2025
ROADS_S3_KEY=overture_extracts/roads/ontario/roads.geojson
```

### Step 3: Test

The snapping service will now:
1. Try to fetch roads from S3 first
2. If S3 fails or returns 0 roads, fallback to database
3. Filter roads by campaign bbox
4. Snap polygon vertices to nearest roads

## Option 2: Use Database (Existing)

Load roads into Supabase:

```sql
-- Check if roads exist
SELECT COUNT(*) FROM overture_transportation;

-- Load roads for Ontario region
-- (Use your existing load scripts)
```

## How It Works

```
Snap Request
    ↓
[SnappingService]
    ↓
Fetch Roads from S3 (Primary)
    - Download GeoJSON from s3://bucket/key
    - Filter by campaign bbox
    - Exclude footways/paths
    ↓ (if 0 roads)
Fetch Roads from DB (Fallback)
    - Call get_roads_in_bbox RPC
    ↓
Snap Vertices to Nearest Roads
    ↓
Return Snapped Polygon
```

## Troubleshooting

### "No road segments found"
- Roads S3 file doesn't exist
- Campaign is outside Ontario (bbox doesn't intersect any roads)
- Check S3: `aws s3 ls s3://flyr-pro-addresses-2025/overture_extracts/roads/ontario/`

### "S3 access denied"
- Check AWS credentials
- Verify bucket policy allows read access

### "Out of memory"
- Ontario roads GeoJSON is ~500MB
- The script filters by bbox before processing
- Consider splitting by region (e.g., durham, toronto, etc.)

## Performance

| Method | Latency | Pros | Cons |
|--------|---------|------|------|
| **S3** | ~2-5s | Always available, no DB load | Download time |
| **DB** | ~200ms | Fast if data exists | Requires data loaded |

## Summary

The snapping service now **prefers S3** and falls back to the database. Just run the extract script once to upload Ontario roads to S3, and snap-to-roads will work for any campaign in Ontario!
