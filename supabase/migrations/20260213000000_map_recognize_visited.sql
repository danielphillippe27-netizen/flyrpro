-- Map: recognize "Mark Visited" (campaign_addresses.visited) so the map shows
-- addresses/buildings as visited (green) when the user has marked them visited
-- in the Addresses tab, even without a QR scan.

CREATE OR REPLACE FUNCTION public.rpc_get_campaign_full_features(
    p_campaign_id uuid
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    result jsonb;
BEGIN
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
                'is_townhome', false,
                'units_count', 0,
                'address_text', ca.formatted,
                'match_method', l.method,
                'feature_status', CASE WHEN l.id IS NOT NULL THEN 'matched' ELSE 'orphan_building' END,
                'feature_type', CASE
                    WHEN slice.id IS NOT NULL THEN 'unit_slice'
                    WHEN l.id IS NOT NULL THEN 'matched_house'
                    ELSE 'orphan'
                END,
                -- Status: "Mark Visited" (ca.visited) OR building_stats/scans so map recognizes both
                'status', CASE
                    WHEN (ca.visited = true) THEN 'visited'
                    ELSE COALESCE(
                        s.status,
                        CASE b.latest_status
                            WHEN 'interested' THEN 'visited'
                            WHEN 'default' THEN 'not_visited'
                            WHEN 'not_home' THEN 'not_visited'
                            WHEN 'dnc' THEN 'not_visited'
                            WHEN 'available' THEN 'not_visited'
                            ELSE 'not_visited'
                        END
                    )
                END,
                'scans_today', COALESCE(s.scans_today, 0),
                'scans_total', COALESCE(s.scans_total, 0),
                'qr_scanned', COALESCE(s.scans_total, 0) > 0,
                'last_scan_seconds_ago', CASE
                    WHEN s.last_scan_at IS NOT NULL THEN extract(epoch from (now() - s.last_scan_at))
                    ELSE NULL
                END,
                'unit_points', NULL,
                'divider_lines', NULL
            )
        ) AS feature
        FROM public.buildings b
        LEFT JOIN public.building_address_links l ON b.id = l.building_id AND l.campaign_id = b.campaign_id
        LEFT JOIN public.campaign_addresses ca ON l.address_id = ca.id
        LEFT JOIN public.building_slices slice ON slice.address_id = ca.id AND slice.building_id = b.id AND slice.campaign_id = b.campaign_id
        LEFT JOIN public.building_stats s ON b.gers_id = s.gers_id
        WHERE b.campaign_id = p_campaign_id
    ) features;

    RETURN result;
END;
$$;

COMMENT ON FUNCTION public.rpc_get_campaign_full_features(uuid) IS
'Returns complete GeoJSON FeatureCollection for a campaign. Status reflects both QR scans (building_stats) and Mark Visited (campaign_addresses.visited) so the map shows visited/touched correctly.';

NOTIFY pgrst, 'reload schema';
