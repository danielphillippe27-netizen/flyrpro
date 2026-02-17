# Toronto Parcel System - Test Checklist

## ✅ What's Ready

| Component | Status | Notes |
|-----------|--------|-------|
| **Parcel data extracted** | ✅ | 527,793 parcels (294 MB) at `data/toronto_parcels.geojson` |
| **Database migration** | ✅ | `20260216160000_parcel_bridge_linker.sql` created |
| **campaign_parcels table** | ⏳ | Created in migration, needs `supabase db reset` |
| **Upload script** | ✅ | `scripts/upload-parcels-to-s3.ts` ready |
| **Load script** | ✅ | `scripts/load-parcels-for-campaign.ts` ready |
| **S3 storage** | ⏳ | Needs upload (one-time) |

---

## 🚀 Test Steps

### Step 1: Apply Database Migration
```bash
cd /Users/danielphillippe/Desktop/FLYR-PRO
supabase db reset
```
**Verify:** Check that `campaign_parcels` table exists in Supabase

---

### Step 2: Upload to S3 (One-Time)
```bash
export AWS_ACCESS_KEY_ID=your_key
export AWS_SECRET_ACCESS_KEY=your_secret
export AWS_REGION=us-east-1

npx tsx scripts/upload-parcels-to-s3.ts
```
**Expected output:**
```
✅ Upload successful!
ETag: "abc123..."
File URL: https://flyr-pro-addresses-2025.s3.amazonaws.com/parcels/toronto/toronto_parcels.geojson
```

---

### Step 3: Load Parcels for a Campaign
```bash
export SUPABASE_SERVICE_ROLE_KEY=your_key

npx tsx scripts/load-parcels-for-campaign.ts 60500756-3246-41a9-b1e4-37ac994b11fc
```
**Expected output:**
```
Campaign bbox: -79.523, 43.653, -79.512, 43.661
Parcels in campaign area: 247
✅ Successfully inserted 247 parcels!
```

---

### Step 4: Run Linker & Verify
```sql
-- Run linker
SELECT link_campaign_data('60500756-3246-41a9-b1e4-37ac994b11fc');

-- Expected result:
-- {
--   "links_created": 150,
--   "covers_count": 23,
--   "parcel_count": 117,  -- <-- This should be > 0!
--   "nearest_count": 10,
--   "method": "parcel_bridge_weighted_nearest"
-- }
```

---

### Step 5: Verify Parcel Links Work
```sql
-- Check which method was used for each link
SELECT 
  method,
  COUNT(*) as count,
  ROUND(AVG(confidence)::numeric, 2) as avg_confidence
FROM building_address_links
WHERE campaign_id = '60500756-3246-41a9-b1e4-37ac994b11fc'
GROUP BY method
ORDER BY count DESC;
```

**Expected result:**
```
method   | count | avg_confidence
---------+-------+----------------
PARCEL   |   117 | 0.95
COVERS   |    23 | 1.00
NEAREST  |    10 | 0.70
```

---

## 🔍 Troubleshooting

### "campaign_parcels table does not exist"
```bash
# Run the migration
supabase db reset
# OR
supabase db push
```

### "S3 access denied"
- Check AWS credentials have write access to `flyr-pro-addresses-2025` bucket
- Verify bucket exists in AWS console

### "No parcels found in campaign area"
- Campaign might be outside Toronto
- Check campaign has `bbox` or `territory_boundary` set
- Try manual bbox: `npx tsx scripts/load-parcels-for-campaign.ts <id> "-79.65,43.65,-79.55,43.75"`

### "parcel_count is 0 after linking"
- Verify parcels were inserted: `SELECT COUNT(*) FROM campaign_parcels WHERE campaign_id = 'xxx'`
- Check addresses fall inside parcel boundaries
- May need to verify SRID (should be 4326/WGS84)

---

## ✅ Success Criteria

The system is working when:

1. ✅ `campaign_parcels` table exists in Supabase
2. ✅ S3 has `parcels/toronto/toronto_parcels.geojson` file
3. ✅ Running `load-parcels-for-campaign.ts` inserts rows into `campaign_parcels`
4. ✅ `link_campaign_data` returns `parcel_count > 0`
5. ✅ Addresses in suburban areas link correctly (not to neighbors)

---

## 📊 Expected Performance

| Metric | Expected |
|--------|----------|
| Upload to S3 | 2-5 minutes (294 MB) |
| Load for campaign | 10-30 seconds (filtering 527k → ~250 parcels) |
| Linker Pass 2 | 1-3 seconds (spatial join) |
| Total memory | < 1 GB |

---

## 🎯 Ready to Test?

Run these commands in order:

```bash
# 1. Apply migration
supabase db reset

# 2. Upload to S3
export AWS_ACCESS_KEY_ID=xxx
export AWS_SECRET_ACCESS_KEY=xxx
npx tsx scripts/upload-parcels-to-s3.ts

# 3. Test with a campaign
export SUPABASE_SERVICE_ROLE_KEY=xxx
npx tsx scripts/load-parcels-for-campaign.ts YOUR_CAMPAIGN_ID

# 4. Run linker in Supabase SQL Editor
SELECT link_campaign_data('YOUR_CAMPAIGN_ID');
```

**Is it working?** Check if `parcel_count > 0` in the result!
