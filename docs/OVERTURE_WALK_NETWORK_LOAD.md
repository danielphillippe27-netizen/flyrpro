# Overture Walk Network Load

Documentation for loading pedestrian walk network data from Overture Maps (S3) into Supabase for walkway snapping functionality.

## Table Schema

The `overture_transportation` table stores transportation segments for two purposes:

1. **House orientation** (existing): Finding nearest road to calculate building bearing
2. **Walkway snapping** (new): Snapping route waypoints to pedestrian walkways

### Required Columns

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key (auto-generated) |
| `gers_id` | text | Overture GERS ID (unique) |
| `geom` | geometry(LineString, 4326) | Segment geometry |
| `class` | text | Overture road class (footway, path, pedestrian, steps, residential, etc.) |
| `subclass` | text | Overture road subclass (sidewalk, crosswalk, etc. when class=footway) |
| `created_at` | timestamptz | Auto-generated timestamp |

### Indexes

- `idx_transport_geom` - GIST spatial index on `geom`
- `idx_transport_gers_id` - B-tree index on `gers_id`
- `idx_transport_class` - B-tree index on `class`
- `idx_transport_subclass` - B-tree index on `subclass` (for walk prioritization)

## Overture Schema Mapping

Overture Maps uses a two-level classification system:

```
subtype = 'road'  (we only care about road segments)
  └── class: 'footway', 'path', 'pedestrian', 'steps', 'residential', 'service', etc.
      └── subclass: 'sidewalk', 'crosswalk' (only for class='footway')
```

### Walk Network Filter (Tier 1)

For walkway snapping, load segments where:

```sql
subtype = 'road'
AND class IN ('footway', 'path', 'pedestrian', 'steps')
```

Include `subclass` when present to enable prioritization:
- `subclass IN ('sidewalk', 'crosswalk')` → Highest priority
- `subclass IS NULL` or other values → Lower priority

### Optional Road Fallback (Tier 2)

If enabling `p_use_road_fallback` in the RPC, also load:

```sql
subtype = 'road'
AND class IN ('residential', 'service')
```

## Data Source

### Option 1: Overture Public S3 (Direct)

```
s3://overturemaps-us-west-2/release/{RELEASE}/theme=transportation/type=segment/*
```

Example release: `2025-12-17.0`

### Option 2: Your Own Extracts

If you have pre-extracted walk network data:

```
s3://your-bucket/overture_extracts/roads/*.parquet
```

## Loading Data

### Method A: Using the Load Script (Recommended)

See `scripts/load-walk-network-to-supabase.ts`:

```bash
# Set environment variables
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_KEY="your-service-key"
export OVERTURE_RELEASE="2025-12-17.0"

# Load walk network (Tier 1 only)
npx tsx scripts/load-walk-network-to-supabase.ts

# Include road fallback (Tier 1 + Tier 2)
npx tsx scripts/load-walk-network-to-supabase.ts --include-road-fallback
```

### Method B: Using DuckDB + psql COPY

```sql
-- In DuckDB
INSTALL spatial;
INSTALL httpfs;
LOAD spatial;
LOAD httpfs;

SET s3_region='us-west-2';

COPY (
  SELECT 
    id as gers_id,
    geometry as geom,
    class,
    subclass
  FROM read_parquet('s3://overturemaps-us-west-2/release/2025-12-17.0/theme=transportation/type=segment/*', hive_partitioning=1)
  WHERE subtype = 'road'
    AND class IN ('footway', 'path', 'pedestrian', 'steps')
    AND geometry IS NOT NULL
) TO 'walk_network.csv' (HEADER, DELIMITER ',');
```

Then load to Supabase:

```sql
-- In psql
\copy overture_transportation(gers_id, geom, class, subclass) FROM 'walk_network.csv' CSV HEADER;
```

### Method C: Using Supabase Edge Function

For automated/scheduled loading, consider creating an Edge Function that:
1. Reads from Overture S3 using DuckDB WASM
2. Streams results to Supabase via POST
3. Runs on a schedule using pg_cron

## Usage Examples

### Single Point Snap

```sql
SELECT * FROM snap_point_to_walkway(-74.006, 40.7128, 50);
-- Returns: lon, lat snapped to nearest walkway
```

### Batch Snap

```sql
SELECT snap_points_to_walkways(
  '[{"lon": -74.006, "lat": 40.7128}, {"lon": -74.007, "lat": 40.713}]'::jsonb,
  50
);
```

### With Road Fallback

```sql
-- If no walkway found, fallback to residential/service roads
SELECT * FROM snap_point_to_walkway(-74.006, 40.7128, 50, true);
```

## Verification

Check that data is loaded correctly:

```sql
-- Count walk network segments
SELECT class, subclass, COUNT(*) 
FROM overture_transportation 
WHERE class IN ('footway', 'path', 'pedestrian', 'steps')
GROUP BY class, subclass;

-- Test snapping in your area
SELECT * FROM snap_point_to_walkway(your_lon, your_lat, 100);
```

## Maintenance

### Refreshing Data

The load script uses upsert by `gers_id`, so you can re-run to update:

```bash
# Full refresh (upserts by gers_id)
npx tsx scripts/load-walk-network-to-supabase.ts
```

### Cleanup

If you need to clear and reload:

```sql
-- Remove all walk network segments
DELETE FROM overture_transportation 
WHERE class IN ('footway', 'path', 'pedestrian', 'steps');

-- Or truncate entire table
TRUNCATE overture_transportation;
```

## Troubleshooting

### No Segments Found in Snapping

1. Verify data is loaded: `SELECT COUNT(*) FROM overture_transportation`
2. Check class distribution: `SELECT class, COUNT(*) FROM overture_transportation GROUP BY class`
3. Test spatial query directly:
   ```sql
   SELECT * FROM overture_transportation 
   WHERE ST_DWithin(geom::geography, ST_MakePoint(lon, lat)::geography, 100)
   LIMIT 5;
   ```

### Performance Issues

1. Ensure spatial index exists: `\di idx_transport_geom`
2. Ensure class index exists: `\di idx_transport_class`
3. Consider partitioning by geography for very large datasets

## Related Files

- `supabase/migrations/20251207000001_create_overture_transportation_table.sql` - Table creation
- `supabase/migrations/20260210000002_overture_transportation_subclass.sql` - Subclass column addition
- `supabase/migrations/20260210000003_update_walkway_snap_rpc.sql` - RPC functions
- `scripts/load-walk-network-to-supabase.ts` - Load script
