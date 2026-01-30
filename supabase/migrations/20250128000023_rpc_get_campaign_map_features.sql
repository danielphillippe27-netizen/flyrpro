-- Stable Linker: RPC that returns GeoJSON from campaign_map_features_v logic for Mapbox
-- Used when campaignId is set; includes feature_status (matched vs orphan_building) and match_method

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
                'is_townhome', COALESCE(b.is_townhome_row, false),
                'units_count', COALESCE(b.units_count, 0),
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
                'unit_points', CASE WHEN b.units_count > 0 AND b.unit_points IS NOT NULL THEN ST_AsGeoJSON(b.unit_points)::jsonb ELSE NULL END,
                'divider_lines', CASE WHEN b.is_townhome_row AND b.divider_lines IS NOT NULL THEN ST_AsGeoJSON(b.divider_lines)::jsonb ELSE NULL END
            )
        ) AS feature
        FROM public.buildings b
        LEFT JOIN public.building_address_links l ON b.id = l.building_id AND l.campaign_id = b.campaign_id
        LEFT JOIN public.campaign_addresses ca ON l.address_id = ca.id
        LEFT JOIN public.building_stats s ON b.id = s.building_id
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
'Returns GeoJSON FeatureCollection for campaign map from stable linker view. Includes feature_status (matched/orphan_building), match_method (COVERS/NEAREST), address_text. Used by MapBuildingsLayer when campaignId is set.';

NOTIFY pgrst, 'reload schema';
