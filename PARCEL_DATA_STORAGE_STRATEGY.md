# Toronto Parcel Data - Storage Strategy

## Overview

The Toronto parcel data contains **527,793 property boundaries** (294 MB GeoJSON) from the Toronto Open Data portal (doi:10.5683/sp3-1vmjag).

## Storage Architecture

### 1. Raw Data: AWS S3 (Source of Truth)

**Location:**
```
s3://flyr-pro-addresses-2025/parcels/toronto/toronto_parcels.geojson
```

**Why S3?**
- ✅ Large file (294 MB) - too big for git
- ✅ Permanent archive
- ✅ Multiple campaigns can reference it
- ✅ Cheap storage ($0.023/GB/month)

**Upload Command:**
```bash
export AWS_ACCESS_KEY_ID=xxx
export AWS_SECRET_ACCESS_KEY=xxx
npx tsx scripts/upload-parcels-to-s3.ts
```

### 2. Campaign Data: Supabase (Operational)

**Table:** `campaign_parcels`

Only parcels that intersect with a campaign's territory are loaded into Supabase.

**Why filter by campaign?**
- ✅ Typical campaign: 100-500 parcels (vs 527,793 total)
- ✅ Fast spatial queries
- ✅ Campaign isolation (delete campaign = delete its parcels)
- ✅ RLS security per user

**Load Command:**
```bash
export AWS_ACCESS_KEY_ID=xxx
export AWS_SECRET_ACCESS_KEY=xxx
export SUPABASE_SERVICE_ROLE_KEY=xxx
npx tsx scripts/load-parcels-for-campaign.ts <campaign-id>
```

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        RAW DATA (S3)                            │
│  s3://flyr-pro-addresses-2025/parcels/toronto/                  │
│  toronto_parcels.geojson (527,793 parcels, 294 MB)              │
└────────────────────────────┬────────────────────────────────────┘
                             │ Download & Filter by BBOX
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CAMPAIGN DATA (Supabase)                     │
│  campaign_parcels table                                         │
│  - Only parcels in campaign territory (100-500 rows)            │
│  - Spatial index for fast queries                               │
│  - RLS: User can only see their campaign parcels                │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      LINKING WORKFLOW                           │
│  Pass 2: PARCEL MATCH                                           │
│  - Address inside Parcel → Links to Building inside same Parcel │
└─────────────────────────────────────────────────────────────────┘
```

## File Structure

```
data/
└── toronto_parcels.geojson          # Local copy (294 MB, gitignored)

scripts/
├── upload-parcels-to-s3.ts          # Upload raw data to S3
└── load-parcels-for-campaign.ts     # Filter & load for specific campaign
```

## Cost Analysis

| Storage | Size | Cost/Month |
|---------|------|------------|
| S3 (raw) | 294 MB | ~$0.007 |
| Supabase (per campaign) | ~2 MB avg | Included in plan |

## Security

### S3
- Bucket: `flyr-pro-addresses-2025` (private)
- Requires AWS credentials to access
- Object encryption at rest

### Supabase
- RLS policy: Users can only see parcels for campaigns they own
- Service role used for bulk inserts
- Row-level isolation per campaign

## Usage Examples

### 1. Upload New Parcel Data

```bash
# After downloading new parcel data from Toronto Open Data
python3 scripts/convert-shapefile-to-geojson.ts  # If needed
npx tsx scripts/upload-parcels-to-s3.ts
```

### 2. Load Parcels for Campaign

```bash
# Automatic bbox from campaign territory
npx tsx scripts/load-parcels-for-campaign.ts 60500756-3246-41a9-b1e4-37ac994b11fc

# Or manual bbox
npx tsx scripts/load-parcels-for-campaign.ts 60500756-3246-41a9-b1e4-37ac994b11fc "-79.65,43.65,-79.55,43.75"
```

### 3. Verify Parcels Loaded

```sql
-- Count parcels for campaign
SELECT COUNT(*) FROM campaign_parcels WHERE campaign_id = '60500756-3246-41a9-b1e4-37ac994b11fc';

-- View sample
SELECT external_id, ST_Area(geom::geography) as area_m2
FROM campaign_parcels
WHERE campaign_id = '60500756-3246-41a9-b1e4-37ac994b11fc'
LIMIT 5;
```

### 4. Run Linker with Parcels

```sql
-- This will now use Pass 2: PARCEL MATCH
SELECT link_campaign_data('60500756-3246-41a9-b1e4-37ac994b11fc');

-- Check results
SELECT 
  method,
  COUNT(*) as count,
  AVG(confidence) as avg_confidence
FROM building_address_links
WHERE campaign_id = '60500756-3246-41a9-b1e4-37ac994b11fc'
GROUP BY method;
```

## GeoJSON Schema

```json
{
  "type": "Feature",
  "properties": {
    "PARCELID": "5126707",
    "FEATURE_TYPE": "COMMON"
  },
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[-79.535, 43.758], ...]]
  }
}
```

**Feature Types:**
- `COMMON` - Standard municipal parcel (491,700 / 93%)
- `CORRIDOR` - Right of way (29,689 / 6%)
- `CONDO` - Condominium boundaries (3,455 / 0.7%)
- `RESERVE` - Access restriction (2,949 / 0.6%)

## Troubleshooting

### "No parcels found in campaign area"
- Campaign may be outside Toronto
- Check bbox coordinates
- Verify parcels exist in S3

### "S3 access denied"
- Check AWS credentials
- Verify bucket policy

### "Insert fails"
- Check Supabase service role key
- Verify `campaign_parcels` table exists
- Check RLS policies

## Future Expansion

To add parcels for other regions:

1. **Oshawa/ Durham Region:**
   ```
   s3://flyr-pro-addresses-2025/parcels/oshawa/oshawa_parcels.geojson
   ```

2. **Mississauga:**
   ```
   s3://flyr-pro-addresses-2025/parcels/mississauga/mississauga_parcels.geojson
   ```

3. Update `load-parcels-for-campaign.ts` to check multiple S3 keys

## Summary

| Aspect | Strategy |
|--------|----------|
| **Raw Data** | S3 (permanent, cheap, large files) |
| **Operational Data** | Supabase (filtered, fast, campaign-scoped) |
| **Access Pattern** | Download from S3 → Filter by bbox → Insert to Supabase |
| **Security** | AWS IAM + Supabase RLS |
| **Cost** | ~$0.01/month for S3 + included Supabase storage |
