-- Fix: Include building_units in campaign map features RPC

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
                'last_scan_seconds_ago', CASE WHEN s.last_scan_at IS NOT NULL THEN extract(epoch from (now() - s.last_scan_at)) ELSE NULL END,
                'is_unit', false
            )
        ) AS feature
        FROM public.buildings b
        LEFT JOIN public.building_address_links l ON b.id = l.building_id AND l.campaign_id = b.campaign_id
        LEFT JOIN public.campaign_addresses ca ON l.address_id = ca.id
        LEFT JOIN public.building_stats s ON b.id = s.building_id
        WHERE b.campaign_id = p_campaign_id
          AND b.geom && bbox
          AND ST_Intersects(b.geom, bbox)
          AND NOT EXISTS (
              SELECT 1 FROM public.building_units bu 
              WHERE bu.campaign_id = p_campaign_id 
                AND bu.parent_building_id = b.gers_id
          )
        
        UNION ALL
        
        SELECT jsonb_build_object(
            'type', 'Feature',
            'id', u.id,
            'geometry', u.unit_geometry,
            'properties', jsonb_build_object(
                'id', u.id,
                'gers_id', u.parent_building_id,
                'parent_building_id', u.parent_building_id,
                'height', 10,
                'height_m', 10,
                'min_height', 0,
                'is_townhome', u.parent_type = 'townhouse',
                'units_count', 1,
                'unit_number', u.unit_number,
                'address_text', ca.formatted,
                'match_method', 'unit_split',
                'feature_status', 'matched',
                'status', COALESCE(u.status, 'not_visited'),
                'scans_today', 0,
                'scans_total', 0,
                'is_unit', true,
                'parent_type', u.parent_type,
                'validation_status', u.validation_status
            )
        ) AS feature
        FROM public.building_units u
        LEFT JOIN public.campaign_addresses ca ON u.address_id = ca.id
        WHERE u.campaign_id = p_campaign_id
        
        LIMIT 1000
    ) features;

    RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_campaign_map_features(float, float, float, float, float, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
