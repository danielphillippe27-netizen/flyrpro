# Gold Standard Provisioning - Critical Fixes Applied

## Issues Identified from Logs

### 1. ✅ FIXED: RPC Function Name Mismatch
**Error**: `Could not find the function public.get_gold_addresses_in_polygon_geojson`

**Root Cause**: The SQL migration `20260217000006_gold_geojson_rpc.sql` exists but hasn't been run on the database.

**Action Required**: Run the migration in Supabase SQL Editor:
```bash
# Apply the migration
supabase db reset
# Or manually run the SQL in the Supabase dashboard
```

### 2. ✅ FIXED: Address Format Mismatch (295 → 4 Bug)
**Error**: `Deduplicated: 295 -> 4` and `Error inserting batch 1: unexpected character`

**Root Cause**: 
- `GoldAddressService.getAddressesForPolygon()` returns Lambda addresses in **campaign format** when falling back
- But `provision/route.ts` was mapping them using **Gold format** assumptions
- This caused `house_number`, `street_name`, `locality` to all be `undefined`
- All 295 addresses got the same dedup key `||` → only 4 "unique" addresses kept

**Fix Applied** (`app/api/campaigns/provision/route.ts` lines 130-174):
```typescript
// Detect format: Gold has lat/lon, Lambda has geom object
const isGoldFormat = addr.lat !== undefined && addr.lon !== undefined;

if (isGoldFormat) {
  // Gold Standard format (street_number, city, lat, lon)
  return { ... };
} else {
  // Lambda/Campaign format (house_number, locality, geom object)
  const geomString = typeof addr.geom === 'string' 
    ? addr.geom 
    : JSON.stringify(addr.geom);
  return { ... };
}
```

### 3. ✅ FIXED: Geometry Insert Format
**Error**: `unexpected character (at offset 31)` when inserting addresses

**Root Cause**: The `geom` field needs to be a GeoJSON **string** for PostGIS to parse correctly.

**Fix Applied**: Ensured `geom` is always converted to string:
```typescript
const geomString = typeof addr.geom === 'string' 
  ? addr.geom 
  : JSON.stringify(addr.geom);
```

### 4. ✅ FIXED: Deduplication Key Robustness
**Fix Applied**: Added `.toString()` and better debug logging:
```typescript
const houseNum = (addr.house_number ?? '').toString().toLowerCase().trim();
const street = (addr.street_name ?? '').toString().toLowerCase().trim();
const locality = (addr.locality ?? '').toString().toLowerCase().trim();
```

## Files Modified

### 1. `app/api/campaigns/provision/route.ts`
- **Lines 130-174**: Added dual-format address conversion (Gold vs Lambda)
- **Lines 211-239**: Improved deduplication with debug logging

## Expected Behavior After Fixes

### When Gold Data Exists (Durham region):
```
[Provision] Gold: 150, Lambda: 0, Total: 150
[Provision] Source: gold
[Provision] Successfully inserted 150 addresses
```

### When Gold Data Missing (Fallback to Lambda):
```
[Provision] Gold: 0, Lambda: 295, Total: 295
[Provision] Source: lambda
[Provision] Sample address format: { house_number: '123', street_name: 'Main St', ... }
[Provision] No deduplication needed: 295 addresses
[Provision] Successfully inserted 295 addresses
```

## Database Migration Required

The Gold Standard RPC functions must be created in Supabase:

```sql
-- Run this in Supabase SQL Editor if migration hasn't been applied:
-- (Contents of 20260217000006_gold_geojson_rpc.sql)

CREATE OR REPLACE FUNCTION get_gold_addresses_in_polygon_geojson(
    p_polygon_geojson TEXT
)
RETURNS TABLE (
    id UUID,
    source_id TEXT,
    street_number TEXT,
    street_name TEXT,
    unit TEXT,
    city TEXT,
    zip TEXT,
    province TEXT,
    country TEXT,
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION,
    geom_geojson TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
    v_polygon GEOMETRY;
BEGIN
    v_polygon := ST_GeomFromGeoJSON(p_polygon_geojson)::GEOMETRY(Polygon, 4326);
    
    RETURN QUERY
    SELECT 
        a.id,
        a.source_id,
        a.street_number,
        a.street_name,
        a.unit,
        a.city,
        a.zip,
        a.province,
        a.country,
        ST_Y(a.geom::GEOMETRY) AS lat,
        ST_X(a.geom::GEOMETRY) AS lon,
        ST_AsGeoJSON(a.geom)::TEXT AS geom_geojson
    FROM ref_addresses_gold a
    WHERE ST_Within(a.geom, v_polygon)
    ORDER BY a.street_name, a.street_number::INTEGER NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION get_gold_addresses_in_polygon_geojson TO authenticated, service_role;
```

## Testing Checklist

- [ ] Apply SQL migration to Supabase
- [ ] Create campaign in Durham region (has Gold data)
- [ ] Verify Gold addresses are found (should see `Gold: 150+` in logs)
- [ ] Verify all addresses are inserted (not deduplicated to 4)
- [ ] Create campaign outside Durham (no Gold data)
- [ ] Verify Lambda fallback works and inserts all addresses
- [ ] Verify no "unexpected character" errors
