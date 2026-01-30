-- The "Unified Glue" Script
-- Standardizes all GERS ID columns to use the name 'gers_id' across all tables
-- This allows the "3D CRM" logic to use the same column name everywhere

-- 1. Standardize 'campaign_addresses'
-- First, drop and recreate the unique constraint with the new column name
ALTER TABLE public.campaign_addresses
DROP CONSTRAINT IF EXISTS campaign_addresses_campaign_source_id_unique;

-- Rename the text column and the UUID column to match 'buildings'
ALTER TABLE public.campaign_addresses RENAME COLUMN source_id TO gers_id;
ALTER TABLE public.campaign_addresses RENAME COLUMN source_id_uuid TO gers_id_uuid;

-- Recreate the unique constraint with the new column name
ALTER TABLE public.campaign_addresses
ADD CONSTRAINT campaign_addresses_campaign_gers_id_unique 
UNIQUE (campaign_id, gers_id);

-- Recreate the partial index for performance
DROP INDEX IF EXISTS public.idx_campaign_addresses_campaign_source_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_addresses_campaign_gers_id 
ON public.campaign_addresses(campaign_id, gers_id)
WHERE gers_id IS NOT NULL;

COMMENT ON CONSTRAINT campaign_addresses_campaign_gers_id_unique ON public.campaign_addresses 
IS 'Full unique constraint on (campaign_id, gers_id) for Supabase onConflict support. Allows multiple NULLs.';

-- 2. Standardize 'map_buildings' (if it exists)
-- Check if columns exist before renaming to avoid errors
DO $$
BEGIN
    -- Rename source_id to gers_id if it exists
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'map_buildings' 
        AND column_name = 'source_id'
    ) THEN
        ALTER TABLE public.map_buildings RENAME COLUMN source_id TO gers_id;
    END IF;

    -- Rename source_id_uuid to gers_id_uuid if it exists
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'map_buildings' 
        AND column_name = 'source_id_uuid'
    ) THEN
        ALTER TABLE public.map_buildings RENAME COLUMN source_id_uuid TO gers_id_uuid;
    END IF;
END $$;

-- 3. Prepare 'contacts' for the 3D CRM
-- This adds the 'Glue' so you can link contacts to their houses
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS gers_id text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS gers_id_uuid uuid;

-- 4. CRITICAL: Update the RPC function properties
-- We need the Mapbox GeoJSON to export 'gers_id' instead of 'source_id'
CREATE OR REPLACE FUNCTION public.rpc_get_buildings_in_bbox(
    min_lon float,
    min_lat float,
    max_lon float,
    max_lat float,
    p_campaign_id uuid DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
    bbox geometry;
    result jsonb;
BEGIN
    -- Create Polygon from BBox
    bbox := st_makeenvelope(min_lon, min_lat, max_lon, max_lat, 4326);

    SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', coalesce(jsonb_agg(features.feature), '[]'::jsonb)
    ) INTO result
    FROM (
        SELECT jsonb_build_object(
            'type', 'Feature',
            'id', b.id,
            'geometry', st_asgeojson(b.geom)::jsonb, -- ST_AsGeoJSON handles MultiPolygon correctly
            'properties', jsonb_build_object(
                'id', b.id,
                'gers_id', b.gers_id, -- GERS ID for linking to contacts (renamed from source_id)
                'height', COALESCE(b.height, 10), -- Use height, fallback to 10
                'height_m', COALESCE(b.height, 10), -- Also include height_m for compatibility
                'min_height', 0,
                'is_townhome', false, -- buildings table doesn't have is_townhome_row, default to false
                'units_count', 0, -- buildings table doesn't have units_count, default to 0
                'status', coalesce(s.status, 'not_visited'),
                'scans_today', coalesce(s.scans_today, 0),
                'scans_total', coalesce(s.scans_total, 0),
                'last_scan_seconds_ago', CASE 
                    WHEN s.last_scan_at IS NOT NULL 
                    THEN extract(epoch from (now() - s.last_scan_at))
                    ELSE NULL
                END,
                -- Embed secondary geometries if zoomed in (townhome lines/points)
                'unit_points', NULL, -- buildings table doesn't have unit_points
                'divider_lines', NULL -- buildings table doesn't have divider_lines
            )
        ) as feature
        FROM public.buildings b
        LEFT JOIN public.building_stats s ON b.id = s.building_id
        WHERE b.geom && bbox -- Spatial Index Intersect (fast)
          AND ST_Intersects(b.geom, bbox) -- Proper overlap check (correct)
          AND (
              -- If campaign_id is provided, include buildings that:
              -- 1. Have the campaign_id set directly, OR
              -- 2. Are linked to addresses in that campaign via gers_id
              p_campaign_id IS NULL 
              OR b.campaign_id = p_campaign_id 
              OR EXISTS (
                  SELECT 1 
                  FROM public.campaign_addresses ca 
                  WHERE ca.gers_id = b.gers_id 
                    AND ca.campaign_id = p_campaign_id
              )
          )
        LIMIT 1000 -- Safety cap
    ) features;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Update comment
COMMENT ON FUNCTION public.rpc_get_buildings_in_bbox IS 'Returns GeoJSON FeatureCollection of buildings in bounding box from the buildings table. Includes gers_id (GERS ID) in properties for linking to contacts. Uses ST_Intersects for proper overlap detection. Handles MultiPolygon geometries correctly. When campaign_id is provided, includes buildings with that campaign_id OR buildings linked to campaign addresses via gers_id.';

-- 5. Refresh the API
NOTIFY pgrst, 'reload schema';
