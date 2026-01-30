-- Fix rpc_get_campaign_map_features: Join building_stats on gers_id instead of building_id
-- The building_stats table uses gers_id (text) as the identifier, not building_id (uuid)

CREATE OR REPLACE FUNCTION public.rpc_get_campaign_map_features(
    min_lon float,
    min_lat float,
    max_lon float,
    max_lat float,
    p_campaign_id uuid
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    bbox geometry;
    result jsonb;
BEGIN
    bbox := ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326);

    SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(jsonb_agg(features.feature), '[]'::jsonb)
    ) INTO result
    FROM (
        SELECT jsonb_build_object(
            'type', 'Feature',
            'id', b.id,
            'geometry', ST_AsGeoJSON(b.geom)::jsonb,
            'properties', jsonb_build_object(
                'id', b.id,
                'gers_id', b.gers_id,
                'height', COALESCE(b.height_m, b.height, 10),
                'height_m', COALESCE(b.height_m, b.height, 10),
                'min_height', 0,
                'is_townhome', false, -- buildings table may not have is_townhome_row column
                'units_count', 0, -- buildings table may not have units_count column
                'address_text', ca.formatted,
                'match_method', l.method,
                'feature_status', CASE WHEN l.id IS NOT NULL THEN 'matched' ELSE 'orphan_building' END,
                'status', COALESCE(
                    s.status,
                    CASE b.latest_status
                        WHEN 'interested' THEN 'visited'
                        WHEN 'default' THEN 'not_visited'
                        WHEN 'not_home' THEN 'not_visited'
                        WHEN 'dnc' THEN 'not_visited'
                        WHEN 'available' THEN 'not_visited'
                        ELSE 'not_visited'
                    END
                ),
                'scans_today', COALESCE(s.scans_today, 0),
                'scans_total', COALESCE(s.scans_total, 0),
                'last_scan_seconds_ago', CASE
                    WHEN s.last_scan_at IS NOT NULL THEN extract(epoch from (now() - s.last_scan_at))
                    ELSE NULL
                END,
                'unit_points', NULL, -- buildings table may not have unit_points column
                'divider_lines', NULL -- buildings table may not have divider_lines column
            )
        ) AS feature
        FROM public.buildings b
        LEFT JOIN public.building_address_links l ON b.id = l.building_id AND l.campaign_id = b.campaign_id
        LEFT JOIN public.campaign_addresses ca ON l.address_id = ca.id
        LEFT JOIN public.building_stats s ON b.gers_id = s.gers_id
        WHERE b.campaign_id = p_campaign_id
          AND b.geom && bbox
          AND ST_Intersects(b.geom, bbox)
        LIMIT 1000
    ) features;

    RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_campaign_map_features(float, float, float, float, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.rpc_get_campaign_map_features(float, float, float, float, uuid) IS
'Returns GeoJSON FeatureCollection for campaign map from stable linker view. Includes feature_status (matched/orphan_building), match_method (COVERS/NEAREST), address_text. Joins building_stats on gers_id (text) to match actual schema.';

NOTIFY pgrst, 'reload schema';
