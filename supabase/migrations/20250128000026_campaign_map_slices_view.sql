-- Voronoi Building Slicer: Update Map View and RPC to Use Slices
-- Updates campaign_map_features_v and rpc_get_campaign_map_features to show slice geometry when available

-- 1. Update campaign_map_features_v to use slices (one row per display unit)
-- Drop and recreate to allow column changes (adding building_id, address_id, feature_type)
DROP VIEW IF EXISTS public.campaign_map_features_v;
CREATE VIEW public.campaign_map_features_v AS
SELECT
    COALESCE(s.id, b.id) AS feature_id,
    b.campaign_id,
    COALESCE(s.geom, b.geom) AS display_geom,
    b.height_m,
    b.gers_id,
    ca.formatted AS address_text,
    ca.house_number,
    l.method AS match_method,
    l.confidence,
    b.id AS building_id,
    ca.id AS address_id,
    CASE
        WHEN l.id IS NOT NULL THEN 'matched'
        ELSE 'orphan_building'
    END AS feature_status,
    CASE
        WHEN s.id IS NOT NULL THEN 'unit_slice'
        WHEN l.id IS NOT NULL THEN 'matched_house'
        ELSE 'orphan'
    END AS feature_type
FROM public.buildings b
LEFT JOIN public.building_address_links l ON b.id = l.building_id AND b.campaign_id = l.campaign_id
LEFT JOIN public.campaign_addresses ca ON l.address_id = ca.id
LEFT JOIN public.building_slices s ON s.address_id = ca.id AND s.building_id = b.id AND s.campaign_id = b.campaign_id;

COMMENT ON VIEW public.campaign_map_features_v IS
'Unified map view: one row per display unit (slice for multi-unit, building for single-unit/orphan). Uses building_slices when available (feature_type=unit_slice), otherwise building footprint (feature_type=matched_house/orphan). feature_status: matched (has link) vs orphan_building (no link). Includes building_id and address_id for UI correlation.';

-- 2. Update rpc_get_campaign_map_features to return one feature per display unit
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
            'id', COALESCE(slice.id, b.id),
            'geometry', ST_AsGeoJSON(COALESCE(slice.geom, b.geom))::jsonb,
            'properties', jsonb_build_object(
                'id', COALESCE(slice.id, b.id),
                'building_id', b.id,
                'address_id', ca.id,
                'gers_id', b.gers_id,
                'height', COALESCE(b.height_m, b.height, 10),
                'height_m', COALESCE(b.height_m, b.height, 10),
                'min_height', 0,
                'is_townhome', false, -- buildings table may not have is_townhome_row column
                'units_count', 0, -- buildings table may not have units_count column
                'address_text', ca.formatted,
                'match_method', l.method,
                'feature_status', CASE WHEN l.id IS NOT NULL THEN 'matched' ELSE 'orphan_building' END,
                'feature_type', CASE
                    WHEN slice.id IS NOT NULL THEN 'unit_slice'
                    WHEN l.id IS NOT NULL THEN 'matched_house'
                    ELSE 'orphan'
                END,
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
        LEFT JOIN public.building_slices slice ON slice.address_id = ca.id AND slice.building_id = b.id AND slice.campaign_id = b.campaign_id
        LEFT JOIN public.building_stats s ON b.gers_id = s.gers_id
        WHERE b.campaign_id = p_campaign_id
          AND COALESCE(slice.geom, b.geom) && bbox
          AND ST_Intersects(COALESCE(slice.geom, b.geom), bbox)
        LIMIT 1000
    ) features;

    RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_campaign_map_features(float, float, float, float, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.rpc_get_campaign_map_features(float, float, float, float, uuid) IS
'Returns GeoJSON FeatureCollection for campaign map with Voronoi slices. One feature per display unit: slice geometry for multi-unit buildings (feature_type=unit_slice), building geometry for single-unit/orphan (feature_type=matched_house/orphan). Feature id is slice id when slice exists, building id otherwise. Includes building_id and address_id in properties for UI correlation. Joins building_stats on gers_id (text) to match actual schema.';

NOTIFY pgrst, 'reload schema';
