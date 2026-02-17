# Parcel Bridge: The "Golden Key" for Address-to-Building Accuracy

## Overview

The **Parcel Bridge** is an optional middle step in the address-to-building linking workflow that dramatically improves accuracy in suburban areas and townhomes. It uses parcel boundaries as "hard containers" to link addresses to buildings regardless of physical distance.

## The Problem It Solves

### 1. The "Driveway" Problem (Suburban Areas like Oshawa)

**Scenario:**
- Address point is at the curb (standard practice)
- House is set back 40m from the road
- Neighbor's house is only 15m away (corner lot situation)

**Without Parcels (Nearest Logic):**
```
Address "100 Main St" → Nearest building is neighbor at 15m (WRONG!)
```

**With Parcels (Parcel Bridge):**
```
Address "100 Main St" → Inside Parcel A → Contains House A at 40m (CORRECT!)
Distance doesn't matter - the parcel is the authority.
```

### 2. The "Townhome Row" Problem

**Scenario:**
- Row of 6 townhomes sharing walls
- GPS points slightly drift between units
- Centroids are in a straight line

**Without Parcels:**
- Slight GPS drift links addresses to wrong units
- Hard to distinguish which unit owns which address

**With Parcels:**
- Each unit has distinct parcel boundary from city surveyor
- Addresses are locked to their specific parcel regardless of GPS drift

## How It Works

### The Workflow: "Covers → Parcel Bridge → Weighted Nearest"

| Pass | Method | Confidence | When It Applies |
|------|--------|------------|-----------------|
| 1 | **COVERS** | 1.0 | Address point is literally inside building footprint |
| 2 | **PARCEL** | 0.95 | Address & building share the same parcel boundary |
| 3 | **NEAREST** | 0.9/0.7/0.4 | Fallback using weighted distance + street matching |

### The Logic

```
Address Point
    ↓
Inside Parcel A? ──No──→ Try Weighted Nearest (Pass 3)
    ↓ Yes
Building Centroid inside Parcel A?
    ↓ Yes
LINKED! (Confidence: 0.95)
```

### Tie-Breaker: Multiple Buildings in One Parcel

Sometimes a parcel contains multiple structures (main house + shed + garage). The query uses `ST_Area(b.geom) DESC` to pick the largest building - almost always the main house.

```sql
ORDER BY ca.id, ST_Area(b.geom) DESC
```

## Database Schema

### New Table: `campaign_parcels`

```sql
CREATE TABLE public.campaign_parcels (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    campaign_id uuid REFERENCES campaigns(id) ON DELETE CASCADE,
    external_id text,        -- "PARCELID" from source (e.g., PCL030544)
    geom geometry(MultiPolygon, 4326),
    properties jsonb,        -- OBJECTID, SHAPE_Area, etc.
    created_at timestamptz DEFAULT now()
);
```

### RLS Policy

Users can only see parcels for campaigns they own:

```sql
CREATE POLICY "Users can view their campaign parcels"
    ON public.campaign_parcels FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.campaigns c
        WHERE c.id = campaign_parcels.campaign_id
        AND c.owner_id = auth.uid()
    ));
```

## API Changes

### Updated Function: `ingest_campaign_raw_data()`

Added optional 5th parameter for parcels:

```sql
CREATE OR REPLACE FUNCTION public.ingest_campaign_raw_data(
  p_campaign_id UUID,
  p_addresses JSONB,
  p_buildings JSONB,
  p_roads JSONB DEFAULT '[]',
  p_parcels JSONB DEFAULT NULL  -- NEW!
) RETURNS JSONB
```

### Return Value

```json
{
  "status": "success",
  "addresses_saved": 150,
  "buildings_saved": 142,
  "roads_saved": 89,
  "parcels_saved": 150   // NEW!
}
```

## Usage

### 1. Ingest Data with Parcels (Server-side)

```typescript
const result = await supabase.rpc('ingest_campaign_raw_data', {
  p_campaign_id: campaignId,
  p_addresses: addressGeoJSON,
  p_buildings: buildingGeoJSON,
  p_roads: roadGeoJSON,
  p_parcels: parcelGeoJSON  // NEW: Optional but recommended
});
```

### 2. Run Linker

```typescript
const result = await supabase.rpc('link_campaign_data', {
  p_campaign_id: campaignId
});

// Returns:
{
  "links_created": 150,
  "covers_count": 23,      // Pass 1
  "parcel_count": 117,     // Pass 2 (NEW!)
  "nearest_count": 10,     // Pass 3
  "slices_created": 5,
  "method": "parcel_bridge_weighted_nearest"
}
```

## GeoJSON Format for Parcels

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "MultiPolygon",
        "coordinates": [[[[-79.65, 43.90], [-79.64, 43.90], ...]]]
      },
      "properties": {
        "PARCELID": "PCL030544",
        "OBJECTID": 12345,
        "SHAPE_Area": 1250.5
      }
    }
  ]
}
```

**Important:** The function looks for:
- `geometry` → Stored as `geom`
- `properties.PARCELID` → Stored as `external_id`
- All other properties → Stored in `properties` JSONB

## Migration Applied

**File:** `supabase/migrations/20260216160000_parcel_bridge_linker.sql`

Contains:
1. `campaign_parcels` table creation
2. Indexes and RLS policies
3. Updated `link_campaign_data()` with Pass 2 (Parcel Match)
4. Updated `ingest_campaign_raw_data()` with optional parcel parameter

## When to Use Parcels

| Scenario | Recommendation |
|----------|----------------|
| Suburban areas (Oshawa, etc.) | **Highly Recommended** |
| Townhome/rowhouse areas | **Highly Recommended** |
| Dense urban cores | Optional (buildings are close to addresses) |
| Rural areas with large lots | **Highly Recommended** |
| Areas with no parcel data | Skip it - Nearest logic will handle it |

## Graceful Degradation

If you don't have parcel data for a campaign, simply don't pass the `p_parcels` parameter (or pass `null`). The linker will:

1. Run Pass 1 (COVERS) - Same as before
2. Run Pass 2 (PARCEL) - Returns 0 rows, does nothing
3. Run Pass 3 (NEAREST) - Handles all unmatched addresses

**No code changes needed** - it's fully backward compatible.

## Performance

- **Parcel join** uses spatial indexes (`idx_campaign_parcels_geom`)
- **ST_Covers** is efficient for point-in-polygon checks
- If no parcels exist for a campaign, Pass 2 is essentially a no-op

## Testing Recommendations

1. **Suburban Test Case**
   - Find an address with a long driveway
   - Verify it links to the correct house (not neighbor)
   - Check `method = 'PARCEL'` in `building_address_links`

2. **Townhome Test Case**
   - Row of 4-6 townhomes
   - Each address should link to its specific unit
   - No cross-unit contamination

3. **No-Parcel Fallback Test**
   - Campaign without parcel data
   - Should still work via Nearest logic
   - `parcel_count = 0` in return value

## Summary

The Parcel Bridge is the **"Golden Key"** for accuracy because:

✅ **Hard container logic** - Parcels are authoritative boundaries
✅ **Solves driveway problem** - Distance becomes irrelevant
✅ **Solves townhome rows** - Each unit is distinctly bounded
✅ **Graceful fallback** - Works without parcel data
✅ **High confidence** - 0.95 confidence for parcel matches
✅ **Invisible to users** - Works as background "glue"
