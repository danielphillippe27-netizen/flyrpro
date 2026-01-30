-- 1. Setup
INSTALL spatial; LOAD spatial;
INSTALL postgres; LOAD postgres;
SET home_directory='/tmp/duckdb';

-- 2. Attach Supabase
-- Shared Pooler Session Mode (port 5432) with project-specific username
-- Key-value format handles the dot in username better than URL format
ATTACH 'dbname=postgres host=aws-0-us-east-1.pooler.supabase.com user=postgres.kfnsnwqylsdsbgnwgxva password=MEGS1989MEGS port=5432 sslmode=require' AS supabase (TYPE POSTGRES);

-- 3. The "OP" Query (Direct from Overture S3)
-- GERS-First Architecture: Use ID-based lookups instead of spatial joins
-- Set S3 region for Overture access
SET s3_region='us-west-2';

-- Campaign ID (update this for different campaigns)
-- TODO: Make this a parameter or read from environment variable
-- For now, update the campaign_id in the WHERE clause below

COPY (
    SELECT 
        id AS gers_id,  -- CRITICAL: Include GERS ID so it's baked into PMTiles properties
        ST_AsGeoJSON(geometry)::JSON as geometry,
        COALESCE(height, (num_floors * 3.5), 10) as render_height,
        addresses[1].freeform as full_address,
        '0c778ab6-2d8a-4278-b6c2-2411b33ba18e' as campaign_id
    FROM read_parquet('s3://overturemaps-us-west-2/release/2025-12-17.0/theme=buildings/type=building/*')
    WHERE id IN (
        SELECT source_id 
        FROM supabase.campaign_addresses 
        WHERE campaign_id = '0c778ab6-2d8a-4278-b6c2-2411b33ba18e'
          AND source_id IS NOT NULL
    )
    -- Note: Bounding box filter removed - ID-based lookup is fast enough
    -- The WHERE id IN (...) clause performs the join efficiently
    -- This replaces the expensive ST_Intersects spatial join with a simple ID match
) TO 'data/buildings.geojson' WITH (FORMAT GDAL, DRIVER 'GeoJSON');

SELECT '✅ Bake Successful!' as status;
