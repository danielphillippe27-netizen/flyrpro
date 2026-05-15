# PostGIS Usage Guide

This document provides a comprehensive guide to PostGIS usage patterns in the FLYR-PRO codebase. It serves as a reference for developers working with spatial data and PostGIS functions.

## Table of Contents

1. [Overview](#overview)
2. [PostGIS Setup](#postgis-setup)
3. [Spatial Data Types](#spatial-data-types)
4. [Spatial Indexes (GIST)](#spatial-indexes-gist)
5. [Common PostGIS Functions](#common-postgis-functions)
6. [Service Patterns](#service-patterns)
7. [Performance Optimization](#performance-optimization)
8. [Geometry Format Conversion](#geometry-format-conversion)

## Overview

FLYR-PRO is a **PostGIS-powered** application that uses PostGIS as a "Spatial Brain" for spatial operations, not just as storage for coordinates. All spatial calculations are performed in the database using PostGIS functions.

### Key Principles

- ✅ **PostGIS Extension**: Enabled in all relevant migrations
- ✅ **Proper Geometry Types**: All spatial columns use `geometry(type, 4326)` with SRID 4326
- ✅ **GIST Indexes**: All geometry columns have GIST spatial indexes for fast queries
- ✅ **Spatial Functions**: Active use of PostGIS functions (ST_Intersects, ST_Centroid, etc.)
- ✅ **Database-First**: Spatial calculations happen in PostgreSQL, not in application code

## PostGIS Setup

### Extension Installation

PostGIS is enabled in migrations:

```sql
-- Found in: supabase/migrations/20251214000000_create_map_buildings_schema.sql
-- Found in: supabase/migrations/20251207000000_create_gers_buildings_tables.sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

### Verification

To verify PostGIS is enabled:

```sql
SELECT PostGIS_version();
```

## Spatial Data Types

### Geometry Columns

All geometry columns use proper PostGIS types with SRID 4326 (WGS84):

| Table | Column | Type | SRID |
|-------|--------|------|------|
| `map_buildings` | `geom` | `geometry(MultiPolygon, 4326)` | 4326 |
| `map_buildings` | `centroid` | `geometry(Point, 4326)` | 4326 |
| `map_buildings` | `divider_lines` | `geometry(MultiLineString, 4326)` | 4326 |
| `map_buildings` | `unit_points` | `geometry(MultiPoint, 4326)` | 4326 |
| `buildings` | `geom` | `geometry(MultiPolygon, 4326)` | 4326 |
| `buildings` | `centroid` | `geometry(Point, 4326)` | 4326 |
| `campaign_addresses` | `geom` | `geography(Point, 4326)` | 4326 |

**Note**: `campaign_addresses.geom` uses `geography` type (not `geometry`) for accurate distance calculations on Earth's surface.

### Generated Columns

PostGIS functions are used in generated columns:

```sql
-- map_buildings.centroid is automatically calculated
centroid geometry(Point, 4326) GENERATED ALWAYS AS (st_centroid(geom)) STORED
```

## Spatial Indexes (GIST)

### The "Search Grid"

GIST (Generalized Search Tree) indexes are the "Search Grid" that enables fast spatial queries. All geometry columns have GIST indexes:

```sql
-- Example from map_buildings table
CREATE INDEX idx_map_buildings_geom ON public.map_buildings USING GIST(geom);
CREATE INDEX idx_map_buildings_centroid ON public.map_buildings USING GIST(centroid);
```

### Index Coverage

✅ **All spatial columns are indexed:**
- `map_buildings.geom` → `idx_map_buildings_geom`
- `map_buildings.centroid` → `idx_map_buildings_centroid`
- `buildings.geom` → `idx_buildings_geom`
- `buildings.centroid` → `idx_buildings_centroid`

### Query Performance

GIST indexes enable:
- Fast bounding box queries (`geom && bbox`)
- Efficient spatial joins (`ST_Intersects`)
- Quick nearest neighbor searches (`ST_DWithin`)

## Common PostGIS Functions

### Spatial Joins

**ST_Intersects** - Check if geometries overlap:

```sql
-- Address-to-building matching (stamp-addresses-with-gers.ts)
ON ST_Intersects(ap.point_geom, o.geometry)

-- BBox overlap detection (rpc_get_buildings_in_bbox)
WHERE b.geom && bbox -- Fast index check
  AND ST_Intersects(b.geom, bbox) -- Accurate overlap
```

**ST_Within** - Check if geometry is inside another:

```sql
-- Polygon boundary filtering (OvertureService.ts)
AND ST_Within(
  geometry,
  ST_GeomFromGeoJSON('...')
)
```

### Distance Calculations

**ST_Distance** - Calculate distance between geometries:

```sql
-- Nearest neighbor queries
ST_Distance(a.address_geometry, ST_Centroid(b.building_geometry))

-- Geography type for accurate Earth distances
ST_Distance(
  t.geom::geography,
  ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography
)
```

**ST_DWithin** - Find geometries within distance:

```sql
-- Find nearest transportation (find_nearest_transportation RPC)
WHERE ST_DWithin(
  t.geom::geography,
  ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography,
  p_radius
)
```

### Geometry Operations

**ST_Centroid** - Calculate centroid point:

```sql
-- Generated column
centroid GENERATED ALWAYS AS (st_centroid(geom)) STORED

-- In queries
ST_Centroid(b.building_geometry)
```

**ST_Subdivide** - Optimize complex polygons:

```sql
-- Optimize for GIST index performance (255 vertices per polygon)
ST_Subdivide(geometry, 255) AS building_geometry
```

**ST_MakeEnvelope** - Create bounding box polygon:

```sql
-- Create bbox for spatial queries
bbox := st_makeenvelope(min_lon, min_lat, max_lon, max_lat, 4326);
```

**ST_Extent** - Calculate bounding box from geometries:

```sql
-- Get campaign bbox (get_campaign_bbox RPC)
SELECT ST_Extent(geom::geometry) AS ext
FROM campaign_addresses
```

### Geometry Conversion

**ST_AsGeoJSON** - Convert to GeoJSON for frontend:

```sql
-- RPC function for Mapbox
'geometry', st_asgeojson(b.geom)::jsonb

-- View conversion
CASE 
  WHEN geom IS NOT NULL THEN ST_AsGeoJSON(geom)::jsonb
  ELSE NULL
END as geom_json
```

**ST_GeomFromWKB** - Convert WKB hex to geometry:

```sql
-- Batch insert from WKB (batch_insert_map_buildings_from_wkb)
v_geom := ST_GeomFromWKB(
  decode(building->>'geom_wkb_hex', 'hex'), 
  4326
)::geometry(MultiPolygon, 4326);
```

### Geometry Type Operations

**ST_GeometryType** - Check geometry type:

```sql
-- Type checking in migrations
WHEN ST_GeometryType(geom) = 'ST_Polygon' THEN
  ST_Multi(geom)::geometry(MultiPolygon, 4326)
```

**ST_Multi** - Convert to MultiPolygon:

```sql
-- Polygon to MultiPolygon conversion
ST_Multi(geom)::geometry(MultiPolygon, 4326)
```

**ST_MakeValid** - Repair invalid geometries:

```sql
-- Geometry repair
ST_Multi(ST_MakeValid(geom))::geometry(MultiPolygon, 4326)
```

## Service Patterns

### MapBuildingsService

**Pattern**: Uses Supabase client with automatic GeoJSON-to-geometry conversion

```typescript
// GeoJSON format (slower, but convenient)
geom: JSON.stringify(building.geometry) // PostGIS converts automatically

// WKB format (3x-5x faster for high-volume imports)
await client.rpc('batch_insert_map_buildings_from_wkb', {
  p_buildings: batchData // Contains geom_wkb_hex
});
```

**Location**: `lib/services/MapBuildingsService.ts`

### BuildingSyncService

**Pattern**: Uses WKB format for efficient geometry transfer from MotherDuck

```typescript
// Convert WKB Buffer to hex string
const wkbHex = wkb.toString('hex');

// Batch upsert via RPC
await supabase.rpc('batch_insert_map_buildings_from_wkb', {
  p_buildings: batchData
});
```

**Location**: `lib/services/BuildingSyncService.ts`

### BuildingService

**Pattern**: Uses PostGIS via RPC functions for spatial queries

```typescript
// Find nearest transportation using PostGIS RPC
const { data } = await client.rpc('find_nearest_transportation', {
  p_lon: lon,
  p_lat: lat,
  p_radius: 100
});
```

**Location**: `lib/services/BuildingService.ts`

**Note**: BuildingService uses Turf.js for client-side calculations (bearing, distance between points), but relies on PostGIS RPC functions for database spatial queries.

### MotherDuckUnifiedService

**Pattern**: Uses DuckDB spatial extension (compatible with PostGIS functions)

```typescript
// DuckDB spatial functions (compatible with PostGIS)
ST_Subdivide(geometry, 255)
ST_Intersects(a.address_geometry, b.building_geometry)
ST_AsGeoJSON(o.geometry)
```

**Location**: `lib/services/MotherDuckUnifiedService.ts`

**Note**: This service works with Overture data in DuckDB, not PostGIS directly. Functions are compatible but run in a different engine.

## Performance Optimization

### WKB vs GeoJSON

**GeoJSON Format** (Current default in MapBuildingsService):
- ✅ Human-readable
- ✅ Easy to work with in TypeScript
- ❌ Requires JSON parsing in PostGIS (slower)
- ❌ Larger payload size

**WKB Format** (Recommended for high-volume imports):
- ✅ 3x-5x faster (no JSON parsing)
- ✅ Smaller payload size
- ✅ Direct binary format
- ❌ Requires conversion from GeoJSON

**When to use WKB:**
- Importing 1000+ buildings at once
- You already have geometry in WKB format (e.g., from DuckDB)
- Performance is critical

**Example:**

```typescript
// GeoJSON (convenient, slower)
await MapBuildingsService.batchInsertBuildings(buildings);

// WKB (faster, requires WKB hex strings)
await MapBuildingsService.batchInsertBuildingsFromWKB(buildings);
```

### ST_Subdivide for Complex Polygons

For complex polygons (U-shaped buildings, large complexes), use `ST_Subdivide` to optimize GIST index performance:

```sql
-- 255 vertices per polygon is optimal for GIST index
ST_Subdivide(geometry, 255) AS building_geometry
```

This reduces false positives in spatial queries.

### Bounding Box Filtering

Always use bounding box filtering before spatial operations:

```sql
-- Fast index check first
WHERE b.geom && bbox -- Uses GIST index

-- Then accurate overlap check
AND ST_Intersects(b.geom, bbox) -- Precise calculation
```

The `&&` operator uses the GIST index for fast filtering, then `ST_Intersects` provides accurate results.

## Geometry Format Conversion

### GeoJSON → PostGIS Geometry

**Automatic conversion** (Supabase client):

```typescript
// Supabase automatically converts GeoJSON strings to PostGIS geometry
geom: JSON.stringify(geoJSONPolygon)
```

**Manual conversion** (SQL):

```sql
-- From GeoJSON text
ST_GeomFromGeoJSON('{"type":"Polygon","coordinates":[...]}')

-- From GeoJSON jsonb
ST_GeomFromGeoJSON(geom_json::text)
```

### PostGIS Geometry → GeoJSON

**For frontend consumption**:

```sql
-- In RPC functions
st_asgeojson(b.geom)::jsonb

-- In views
CASE 
  WHEN geom IS NOT NULL THEN ST_AsGeoJSON(geom)::jsonb
  ELSE NULL
END as geom_json
```

### WKB → PostGIS Geometry

**From WKB hex string**:

```sql
-- Decode hex and convert to geometry
ST_GeomFromWKB(
  decode(geom_wkb_hex, 'hex'), 
  4326
)::geometry(MultiPolygon, 4326)
```

**From WKB Buffer** (TypeScript):

```typescript
// Convert Buffer to hex string
const wkbHex = buffer.toString('hex');

// Send to RPC function
await client.rpc('batch_insert_map_buildings_from_wkb', {
  p_buildings: [{ geom_wkb_hex: wkbHex, ... }]
});
```

## RPC Functions

### rpc_get_buildings_in_bbox

Returns GeoJSON FeatureCollection of buildings in bounding box.

**Usage:**

```typescript
const { data } = await supabase.rpc('rpc_get_buildings_in_bbox', {
  min_lon: -122.5,
  min_lat: 37.7,
  max_lon: -122.4,
  max_lat: 37.8,
  p_campaign_id: campaignId // Optional
});
```

**PostGIS Functions Used:**
- `ST_MakeEnvelope` - Create bbox polygon
- `ST_AsGeoJSON` - Convert to GeoJSON
- `ST_Intersects` - Overlap detection
- `&&` operator - Fast index check

### batch_insert_map_buildings_from_wkb

Batch insert/update buildings from WKB hex strings.

**Usage:**

```typescript
const { data } = await supabase.rpc('batch_insert_map_buildings_from_wkb', {
  p_buildings: [
    {
      source_id: 'gers-id-123',
      geom_wkb_hex: '0103000000...', // WKB hex string
      height_m: 10,
      levels: 3,
      campaign_id: 'uuid-here'
    }
  ]
});
```

**PostGIS Functions Used:**
- `ST_GeomFromWKB` - Convert WKB to geometry
- `decode(..., 'hex')` - Decode hex string

### find_nearest_transportation

Find nearest transportation segment to a point.

**Usage:**

```typescript
const { data } = await supabase.rpc('find_nearest_transportation', {
  p_lon: -122.4194,
  p_lat: 37.7749,
  p_radius: 100 // meters
});
```

**PostGIS Functions Used:**
- `ST_MakePoint` - Create point geometry
- `ST_SetSRID` - Set SRID 4326
- `ST_Distance` - Calculate distance (geography type)
- `ST_DWithin` - Filter by distance

### get_campaign_bbox

Get bounding box for all addresses in a campaign.

**Usage:**

```typescript
const { data } = await supabase.rpc('get_campaign_bbox', {
  c_id: campaignId
});
```

**PostGIS Functions Used:**
- `ST_Extent` - Calculate bounding box
- `ST_XMin`, `ST_YMin`, `ST_XMax`, `ST_YMax` - Extract bbox coordinates

## Best Practices

### 1. Always Use SRID 4326

All geometry columns should use SRID 4326 (WGS84):

```sql
geometry(MultiPolygon, 4326)
geometry(Point, 4326)
```

### 2. Use GIST Indexes

All geometry columns must have GIST indexes:

```sql
CREATE INDEX idx_table_geom ON table_name USING GIST(geom);
```

### 3. Prefer Geography for Distance

Use `geography` type for accurate Earth distance calculations:

```sql
-- For campaign_addresses (point locations)
geography(Point, 4326)

-- In distance queries
ST_Distance(geom1::geography, geom2::geography)
```

### 4. Use Bounding Box Filtering

Always filter by bounding box before spatial operations:

```sql
WHERE geom && bbox -- Fast index check
  AND ST_Intersects(geom, bbox) -- Accurate check
```

### 5. Optimize Complex Polygons

Use `ST_Subdivide` for complex polygons:

```sql
ST_Subdivide(geometry, 255) -- Optimal for GIST index
```

### 6. Choose Format Based on Volume

- **GeoJSON**: Convenient for small batches (< 100 buildings)
- **WKB**: Required for high-volume imports (1000+ buildings)

## Troubleshooting

### Missing Spatial Index

**Symptom**: Slow spatial queries

**Solution**: Create GIST index:

```sql
CREATE INDEX idx_table_geom ON table_name USING GIST(geom);
```

### Invalid Geometry

**Symptom**: `ST_GeomFromGeoJSON` errors

**Solution**: Use `ST_MakeValid`:

```sql
ST_MakeValid(ST_GeomFromGeoJSON(geom_json))
```

### Wrong SRID

**Symptom**: Incorrect spatial calculations

**Solution**: Ensure all geometries use SRID 4326:

```sql
ST_SetSRID(geom, 4326)
```

## References

- [PostGIS Documentation](https://postgis.net/documentation/)
- [Supabase PostGIS Guide](https://supabase.com/docs/guides/database/extensions/postgis)
- [GIST Indexes](https://postgis.net/docs/using_postgis_dbmanagement.html#spatial_indexes)

## Audit Results

✅ **System is PostGIS-powered** with:
- PostGIS extension enabled
- Proper geometry types with SRID 4326
- GIST indexes on all spatial columns
- Active use of PostGIS functions throughout codebase
- Spatial calculations performed in database

**Last Updated**: January 27, 2025
