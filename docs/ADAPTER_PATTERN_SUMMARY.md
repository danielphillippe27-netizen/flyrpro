# Adapter Pattern Implementation Summary

## Overview
Created two adapter modules that normalize data from any source (Gold DB or Lambda/Silver) into a standard format.

## New Modules

### 1. AddressAdapter (`lib/services/AddressAdapter.ts`)
Normalizes addresses from Gold or Lambda format to standard campaign address format.

```typescript
// Usage in provision route:
let addressesToInsert = AddressAdapter.normalizeArray(
  goldResult.addresses,  // Works with Gold OR Lambda format
  campaign_id!
);
```

**Input formats handled:**
- **Gold**: `{street_number, street_name, city, lat, lon}`
- **Lambda**: `{house_number, street_name, locality, geom}`

**Output format:**
```typescript
{
  campaign_id: string;
  formatted: string;
  house_number?: string;
  street_name?: string;
  locality?: string;
  region?: string;
  postal_code?: string;
  coordinate?: {lat, lon};
  geom: string; // GeoJSON string for PostGIS
  source: 'gold' | 'lambda';
}
```

### 2. BuildingAdapter (`lib/services/BuildingAdapter.ts`)
Normalizes buildings from Gold DB rows or Lambda GeoJSON to standard GeoJSON.

```typescript
// Usage in provision route:
const { buildings: normalizedBuildingsGeoJSON, overtureRelease } = 
  await BuildingAdapter.fetchAndNormalize(goldBuildings, snapshot);
```

**Input formats handled:**
- **Gold**: Database rows with `geom_geojson` string
- **Lambda**: GeoJSON FeatureCollection from S3

**Output format:**
```typescript
{
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    geometry: GeoJSON.Polygon | MultiPolygon,
    properties: {
      gers_id: string;
      external_id?: string;
      area?: number;
      height?: number;
      layer: 'building';
    }
  }]
}
```

## Benefits

1. **Single Source of Truth**: Data normalization happens in one place
2. **Downstream Simplicity**: StableLinker and TownhouseSplitter receive consistent format
3. **Easy to Extend**: Add new data sources by adding adapter methods
4. **Type Safety**: Full TypeScript interfaces for all formats
5. **No Code Duplication**: Normalized once, used everywhere

## Files Modified

1. **`lib/services/BuildingAdapter.ts`** (new)
2. **`lib/services/AddressAdapter.ts`** (new)
3. **`app/api/campaigns/provision/route.ts`** - Uses adapters

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Provisioning Flow                       │
└─────────────────────────────────────────────────────────────┘

Gold Path (Durham):
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│ Gold DB Rows │────▶│   Adapter    │────▶│ Standard Format  │
└──────────────┘     └──────────────┘     └──────────────────┘
                                                  │
                     ┌──────────────┐            │
                     │ StableLinker │◀───────────┘
                     │    &         │
                     │ Townhouse    │◀───────────┐
                     └──────────────┘            │
                                                  │
Silver Path (Other):                              │
┌──────────────┐     ┌──────────────┐     ┌──────┴───────────┐
│ S3 Download  │────▶│   Adapter    │────▶│ Standard Format  │
└──────────────┘     └──────────────┘     └──────────────────┘
```

## Testing

Both paths now use the same downstream code:
- `StableLinkerService.runSpatialJoin()`
- `TownhouseSplitterService.processCampaignTownhouses()`

The services don't need to know where the data came from!
