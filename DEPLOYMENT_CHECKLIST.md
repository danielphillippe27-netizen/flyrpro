# Gold Standard Deployment Checklist

## ✅ Code Changes (Complete)

### New Adapter Modules
- ✅ `lib/services/BuildingAdapter.ts` - Normalizes buildings from Gold/Silver
- ✅ `lib/services/AddressAdapter.ts` - Normalizes addresses from Gold/Silver

### Updated Files
- ✅ `app/api/campaigns/provision/route.ts` - Uses adapters, skips duplicate inserts
- ✅ `lib/services/StableLinkerService.ts` - Parses geom strings

## ⚠️ SQL Migrations Required

Run these in Supabase SQL Editor:

### 1. Gold Standard GeoJSON RPC (Already Applied ✓)
```sql
-- get_gold_addresses_in_polygon_geojson
-- get_gold_buildings_in_polygon_geojson
```

### 2. Campaign Addresses GeoJSON RPC (Optional - Not Required)
```sql
-- File: 20260217000007_campaign_addresses_geojson_rpc.sql
-- Function: get_campaign_addresses_geojson
-- 
-- NOTE: This is optional. Current code parses geom strings in JS.
-- Apply this later for better performance.
```

### 3. Address Orphans Batch Insert (If Not Applied)
```sql
-- File: 20260210100000_address_orphans_gold_standard.sql
-- Function: insert_address_orphans_batch
```

## Test Results

### ✅ Working
- Gold addresses query: `Found 294 Gold addresses`
- Address adapter: `Normalizing 294 Gold addresses`
- Building adapter: `Normalizing 283 Gold buildings`
- Deduplication: `No deduplication needed: 294 addresses`

### ⚠️ Fixed Issues
1. **Duplicate key error** - Now checks if addresses exist before inserting
2. **Stable Linker geom parsing** - Parses string geom to object

### 🔧 Still To Test
- Spatial join matching (needs addresses in DB)
- Townhouse splitting on Gold buildings

## Next Steps

1. Test full provision flow
2. Check spatial join results
3. Apply optional SQL migrations for performance
