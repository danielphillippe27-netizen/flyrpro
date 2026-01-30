-- Migrate map_buildings.geom from Polygon to MultiPolygon
-- This is critical for handling complex buildings (courtyards, multi-part structures)
-- Part of Task A: Schema Migration

-- 1. Convert existing Polygon geometries to MultiPolygon
-- Wrap single Polygons in MultiPolygon, preserve existing MultiPolygons if any
UPDATE public.map_buildings
SET geom = CASE 
    WHEN ST_GeometryType(geom) = 'ST_Polygon' THEN
        ST_Multi(geom)::geometry(MultiPolygon, 4326)
    WHEN ST_GeometryType(geom) = 'ST_MultiPolygon' THEN
        geom::geometry(MultiPolygon, 4326)
    ELSE
        -- Fallback: try to convert to MultiPolygon
        ST_Multi(ST_MakeValid(geom))::geometry(MultiPolygon, 4326)
END
WHERE geom IS NOT NULL;

-- 2. Alter column type to MultiPolygon
-- This will fail if there are any non-Polygon/MultiPolygon geometries
ALTER TABLE public.map_buildings 
ALTER COLUMN geom TYPE geometry(MultiPolygon, 4326) 
USING CASE 
    WHEN ST_GeometryType(geom) = 'ST_Polygon' THEN
        ST_Multi(geom)::geometry(MultiPolygon, 4326)
    WHEN ST_GeometryType(geom) = 'ST_MultiPolygon' THEN
        geom::geometry(MultiPolygon, 4326)
    ELSE
        ST_Multi(ST_MakeValid(geom))::geometry(MultiPolygon, 4326)
END;

-- 3. Verify GIST spatial index (should remain valid, but verify)
-- The index on geometry columns works with any geometry type
-- Drop and recreate to ensure it's optimized for MultiPolygon
DROP INDEX IF EXISTS idx_map_buildings_geom;
CREATE INDEX idx_map_buildings_geom ON public.map_buildings USING GIST(geom);

-- 4. Verify centroid generated column still works
-- ST_Centroid handles both Polygon and MultiPolygon correctly
-- The generated column should automatically work, but we can verify with a comment
COMMENT ON COLUMN public.map_buildings.centroid IS 'Generated centroid point. ST_Centroid handles MultiPolygon correctly.';

-- 5. Update RPC function to add ST_Intersects check for proper overlap detection
-- This ensures we get buildings that intersect the bbox, not just those fully contained
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
                'height_m', COALESCE(b.height_m, 10), -- Building height in meters from map_buildings table
                'min_height', 0,
                'is_townhome', b.is_townhome_row,
                'units_count', b.units_count,
                'status', coalesce(s.status, 'not_visited'),
                'scans_today', coalesce(s.scans_today, 0),
                'scans_total', coalesce(s.scans_total, 0),
                'last_scan_seconds_ago', CASE 
                    WHEN s.last_scan_at IS NOT NULL 
                    THEN extract(epoch from (now() - s.last_scan_at))
                    ELSE NULL
                END,
                -- Embed secondary geometries if zoomed in (townhome lines/points)
                'unit_points', CASE 
                    WHEN b.units_count > 0 AND b.unit_points IS NOT NULL
                    THEN st_asgeojson(b.unit_points)::jsonb 
                    ELSE NULL 
                END,
                'divider_lines', CASE
                    WHEN b.is_townhome_row AND b.divider_lines IS NOT NULL
                    THEN st_asgeojson(b.divider_lines)::jsonb
                    ELSE NULL
                END
            )
        ) as feature
        FROM public.map_buildings b
        LEFT JOIN public.building_stats s ON b.id = s.building_id
        WHERE b.geom && bbox -- Spatial Index Intersect (fast)
          AND ST_Intersects(b.geom, bbox) -- Proper overlap check (correct)
          AND (p_campaign_id IS NULL OR b.campaign_id = p_campaign_id) -- Filter by campaign if provided
        LIMIT 1000 -- Safety cap
    ) features;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- 6. RPC Function: Batch insert/update buildings from WKB hex strings
-- Used by BuildingSyncService to efficiently sync buildings from MotherDuck
CREATE OR REPLACE FUNCTION public.batch_insert_map_buildings_from_wkb(
    p_buildings jsonb
)
RETURNS jsonb AS $$
DECLARE
    building jsonb;
    v_geom geometry(MultiPolygon, 4326);
    v_source_id text;
    v_height_m numeric;
    v_levels int;
    v_campaign_id uuid;
    v_created int := 0;
    v_updated int := 0;
    v_errors int := 0;
BEGIN
    -- Process each building in the JSON array
    FOR building IN SELECT * FROM jsonb_array_elements(p_buildings)
    LOOP
        BEGIN
            v_source_id := building->>'source_id';
            v_height_m := COALESCE((building->>'height_m')::numeric, 6);
            v_levels := COALESCE((building->>'levels')::int, 2);
            v_campaign_id := CASE 
                WHEN building->>'campaign_id' IS NOT NULL 
                THEN (building->>'campaign_id')::uuid 
                ELSE NULL 
            END;
            
            -- Convert hex string to WKB and then to geometry
            v_geom := ST_GeomFromWKB(
                decode(building->>'geom_wkb_hex', 'hex'), 
                4326
            )::geometry(MultiPolygon, 4326);
            
            -- Check if building exists before upsert
            IF EXISTS (SELECT 1 FROM public.map_buildings WHERE source_id = v_source_id) THEN
                -- Update existing
                UPDATE public.map_buildings
                SET 
                    geom = v_geom,
                    height_m = v_height_m,
                    levels = v_levels,
                    campaign_id = COALESCE(v_campaign_id, campaign_id),
                    updated_at = now()
                WHERE source_id = v_source_id;
                v_updated := v_updated + 1;
            ELSE
                -- Insert new
                INSERT INTO public.map_buildings (
                    source_id,
                    geom,
                    height_m,
                    levels,
                    campaign_id
                )
                VALUES (
                    v_source_id,
                    v_geom,
                    v_height_m,
                    v_levels,
                    v_campaign_id
                );
                v_created := v_created + 1;
            END IF;
            
        EXCEPTION WHEN OTHERS THEN
            v_errors := v_errors + 1;
            -- Log error but continue processing
            RAISE WARNING 'Error processing building %: %', v_source_id, SQLERRM;
        END;
    END LOOP;
    
    RETURN jsonb_build_object(
        'created', v_created,
        'updated', v_updated,
        'errors', v_errors,
        'total', jsonb_array_length(p_buildings)
    );
END;
$$ LANGUAGE plpgsql;

-- 7. Add comment documenting the change
COMMENT ON COLUMN public.map_buildings.geom IS 'Building footprint geometry as MultiPolygon (supports complex buildings with courtyards, multi-part structures). Changed from Polygon in migration 20251215000000.';
COMMENT ON FUNCTION public.rpc_get_buildings_in_bbox IS 'Returns GeoJSON FeatureCollection of buildings in bounding box. Uses ST_Intersects for proper overlap detection. Handles MultiPolygon geometries correctly.';
COMMENT ON FUNCTION public.batch_insert_map_buildings_from_wkb IS 'Batch inserts/updates map_buildings from WKB hex strings. Accepts JSON array of buildings. Used by BuildingSyncService for efficient geometry transfer from MotherDuck.';
