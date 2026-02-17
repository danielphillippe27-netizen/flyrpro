-- ============================================================================
-- GOLD STANDARD: Map Features RPC
-- ============================================================================
-- Returns GeoJSON for map display using Gold buildings linked to campaign
-- ============================================================================

DROP FUNCTION IF EXISTS public.rpc_get_campaign_full_features(uuid);

CREATE OR REPLACE FUNCTION public.rpc_get_campaign_full_features(
    p_campaign_id uuid
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    result jsonb;
    v_count bigint;
BEGIN
    -- Check if campaign has Gold-linked buildings
    SELECT COUNT(*) INTO v_count
    FROM campaign_addresses ca
    WHERE ca.campaign_id = p_campaign_id
      AND ca.building_id IS NOT NULL;

    IF v_count > 0 THEN
        -- Gold path: Use linked Gold buildings
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
                    'building_id', b.id,
                    'address_id', ca.id,
                    'gers_id', b.id,
                    'height', 10,
                    'height_m', 10,
                    'min_height', 0,
                    'is_townhome', false,
                    'units_count', 0,
                    'address_text', ca.formatted,
                    'match_method', ca.match_source,
                    'feature_status', 'matched',
                    'feature_type', CASE 
                        WHEN ca.match_source = 'gold_exact' THEN 'matched_house'
                        ELSE 'matched_house'
                    END,
                    'status', CASE 
                        WHEN ca.visited = true THEN 'visited'
                        ELSE 'not_visited'
                    END,
                    'scans_today', 0,
                    'scans_total', 0,
                    'qr_scanned', false,
                    'last_scan_seconds_ago', NULL,
                    'unit_points', NULL,
                    'divider_lines', NULL,
                    'confidence', ca.confidence
                )
            ) AS feature
            FROM campaign_addresses ca
            JOIN ref_buildings_gold b ON ca.building_id = b.id
            WHERE ca.campaign_id = p_campaign_id
              AND ca.building_id IS NOT NULL
        ) features;
    ELSE
        -- Fallback: Return empty or use old logic if available
        result := jsonb_build_object(
            'type', 'FeatureCollection',
            'features', '[]'::jsonb
        );
    END IF;

    RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_campaign_full_features(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.rpc_get_campaign_full_features(uuid) IS
'Returns GeoJSON FeatureCollection for campaign map. Gold Standard version uses ref_buildings_gold joined via campaign_addresses.building_id.';

NOTIFY pgrst, 'reload schema';
