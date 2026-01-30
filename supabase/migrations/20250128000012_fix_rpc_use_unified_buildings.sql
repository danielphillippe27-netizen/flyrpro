-- Fix RPC to use unified buildings table
-- Updates rpc_get_buildings_in_bbox to query from public.buildings instead of public.map_buildings
-- Returns gers_id in properties for contact linking
-- Maps latest_status to map status values when building_stats is not available

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
        'features', COALESCE(jsonb_agg(features.feature), '[]'::jsonb)
    ) INTO result
    FROM (
        SELECT jsonb_build_object(
            'type', 'Feature',
            'id', b.id,
            'geometry', st_asgeojson(b.geom)::jsonb, -- ST_AsGeoJSON handles MultiPolygon correctly
            'properties', jsonb_build_object(
                'id', b.id,
                'gers_id', b.gers_id, -- GERS ID for linking to contacts (standardized name)
                'height', COALESCE(b.height_m, b.height, 10), -- Use height_m first, then height, fallback to 10
                'height_m', COALESCE(b.height_m, b.height, 10), -- Also include height_m for compatibility
                'min_height', 0,
                'is_townhome', COALESCE(b.is_townhome_row, false),
                'units_count', COALESCE(b.units_count, 0),
                -- Status: Use building_stats.status if available, otherwise map from latest_status
                'status', COALESCE(
                    s.status, -- building_stats.status has 'not_visited', 'visited', 'hot'
                    CASE b.latest_status
                        WHEN 'interested' THEN 'visited'
                        WHEN 'default' THEN 'not_visited'
                        WHEN 'not_home' THEN 'not_visited'
                        WHEN 'dnc' THEN 'not_visited'
                        WHEN 'available' THEN 'not_visited' -- Newly provisioned buildings (Red)
                        ELSE 'not_visited'
                    END
                ),
                'scans_today', COALESCE(s.scans_today, 0),
                'scans_total', COALESCE(s.scans_total, 0),
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
        FROM public.buildings b
        LEFT JOIN public.building_stats s ON b.id = s.building_id
        WHERE b.geom && bbox -- Spatial Index Intersect (fast)
          AND st_intersects(b.geom, bbox) -- Proper overlap check (correct)
          AND (
              -- If campaign_id is provided, include buildings that:
              -- 1. Have the campaign_id set directly, OR
              -- 2. Are linked to addresses in that campaign via address_id
              p_campaign_id IS NULL 
              OR b.campaign_id = p_campaign_id 
              OR EXISTS (
                  SELECT 1 
                  FROM public.campaign_addresses ca 
                  WHERE ca.id = b.address_id 
                    AND ca.campaign_id = p_campaign_id
              )
          )
        LIMIT 1000 -- Safety cap
    ) features;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.rpc_get_buildings_in_bbox(float, float, float, float, uuid) TO authenticated, service_role;

-- Update comment
COMMENT ON FUNCTION public.rpc_get_buildings_in_bbox IS 
'Returns GeoJSON FeatureCollection of buildings in bounding box from the unified buildings table. Includes gers_id (GERS ID) in properties for linking to contacts. Uses ST_Intersects for proper overlap detection. Handles MultiPolygon geometries correctly. When campaign_id is provided, includes buildings with that campaign_id OR buildings linked to campaign addresses via address_id. Status is taken from building_stats if available, otherwise mapped from buildings.latest_status.';

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
