-- ============================================================================
-- FIX: Deduplicate Gold buildings in the feature RPC
--
-- PROBLEM: The Gold path emitted one GeoJSON feature PER ADDRESS. When a Gold
--          building has multiple addresses (e.g. townhouse row), N identical
--          polygons were stacked on the map. On click, the feature always had
--          address_id set → LocationCard skipped list mode → user never saw
--          "N addresses" picker.
--
-- FIX:     GROUP BY building in the Gold path so each building emits exactly
--          ONE feature. Multi-address buildings get address_id = NULL (triggers
--          list mode in the UI) and address_count > 1. Single-address buildings
--          keep address_id set (direct to detail).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_get_campaign_full_features(
    p_campaign_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
    result        JSONB;
    v_gold_count  BIGINT;
    v_silver_count BIGINT;
BEGIN
    -- ====================================================================
    -- Gold path: campaign_addresses.building_id -> ref_buildings_gold
    -- Deduplicated: one feature per building, multi-address aware
    -- ====================================================================
    SELECT COUNT(DISTINCT ca.building_id) INTO v_gold_count
    FROM campaign_addresses ca
    WHERE ca.campaign_id = p_campaign_id
      AND ca.building_id IS NOT NULL;

    IF v_gold_count > 0 THEN
        SELECT jsonb_build_object(
            'type', 'FeatureCollection',
            'features', COALESCE(jsonb_agg(f.feature), '[]'::jsonb)
        ) INTO result
        FROM (
            SELECT jsonb_build_object(
                'type', 'Feature',
                'id', g.building_id,
                'geometry', ST_AsGeoJSON(g.geom)::jsonb,
                'properties', jsonb_build_object(
                    'id',             g.building_id,
                    'feature_id',     g.building_id,
                    'building_id',    g.building_id,
                    'gers_id',        g.building_id,
                    -- Single-address → set address_id (detail mode)
                    -- Multi-address  → NULL (list mode in LocationCard)
                    'address_id',     CASE WHEN g.addr_count = 1 THEN g.first_addr_id ELSE NULL END,
                    'address_text',   g.first_formatted,
                    'house_number',   g.first_house_number,
                    'street_name',    g.first_street_name,
                    'address_count',  g.addr_count,
                    'height',         COALESCE(g.height_m, 10),
                    'height_m',       COALESCE(g.height_m, 10),
                    'min_height',     0,
                    'feature_status', 'matched',
                    'feature_type',   'matched_house',
                    'match_method',   g.match_source,
                    'confidence',     g.confidence,
                    'status',         g.status,
                    'scans_total',    g.scans_total,
                    'qr_scanned',     g.scans_total > 0,
                    'source',         'gold'
                )
            ) AS feature
            FROM (
                SELECT
                    b.id                    AS building_id,
                    b.geom,
                    b.height_m,
                    COUNT(*)                AS addr_count,
                    -- Pick representative address (lowest house number first)
                    (array_agg(ca.id        ORDER BY ca.house_number NULLS LAST))[1] AS first_addr_id,
                    (array_agg(ca.formatted ORDER BY ca.house_number NULLS LAST))[1] AS first_formatted,
                    (array_agg(ca.house_number ORDER BY ca.house_number NULLS LAST))[1] AS first_house_number,
                    (array_agg(ca.street_name  ORDER BY ca.house_number NULLS LAST))[1] AS first_street_name,
                    (array_agg(COALESCE(ca.match_source, 'gold_exact')
                               ORDER BY ca.house_number NULLS LAST))[1] AS match_source,
                    MAX(COALESCE(ca.confidence, 1.0))   AS confidence,
                    -- Building visited if ANY address visited
                    CASE WHEN bool_or(ca.visited) THEN 'visited' ELSE 'not_visited' END AS status,
                    -- Sum scans across all addresses
                    SUM(COALESCE(ca.scans, 0))::int     AS scans_total
                FROM campaign_addresses ca
                JOIN ref_buildings_gold b ON b.id = ca.building_id
                WHERE ca.campaign_id = p_campaign_id
                  AND ca.building_id IS NOT NULL
                GROUP BY b.id, b.geom, b.height_m
            ) g
        ) f;

        RETURN result;
    END IF;

    -- ====================================================================
    -- Silver/GERS path: building_address_links -> buildings (unchanged)
    -- ====================================================================
    SELECT COUNT(*) INTO v_silver_count
    FROM building_address_links bal
    WHERE bal.campaign_id = p_campaign_id;

    IF v_silver_count > 0 THEN
        SELECT jsonb_build_object(
            'type', 'FeatureCollection',
            'features', COALESCE(jsonb_agg(f.feature), '[]'::jsonb)
        ) INTO result
        FROM (
            SELECT jsonb_build_object(
                'type', 'Feature',
                'id', b.gers_id,
                'geometry', ST_AsGeoJSON(b.geom)::jsonb,
                'properties', jsonb_build_object(
                    'id', b.gers_id,
                    'feature_id', bal.address_id,
                    'building_id', b.gers_id,
                    'gers_id', b.gers_id,
                    'address_id', ca.id,
                    'address_text', ca.formatted,
                    'house_number', ca.house_number,
                    'street_name', ca.street_name,
                    'height', COALESCE(b.height, 10),
                    'height_m', COALESCE(b.height, 10),
                    'min_height', 0,
                    'feature_status', 'matched',
                    'feature_type', 'matched_house',
                    'match_method', COALESCE(bal.match_type, 'silver'),
                    'confidence', COALESCE(bal.confidence, 0.8),
                    'status', CASE WHEN ca.visited THEN 'visited' ELSE 'not_visited' END,
                    'scans_total', COALESCE(ca.scans, 0),
                    'qr_scanned', COALESCE(ca.scans, 0) > 0,
                    'source', 'silver'
                )
            ) AS feature
            FROM building_address_links bal
            JOIN buildings b ON b.gers_id = bal.building_id
            JOIN campaign_addresses ca ON ca.id = bal.address_id
            WHERE bal.campaign_id = p_campaign_id
        ) f;

        RETURN result;
    END IF;

    -- ====================================================================
    -- Fallback: address points (no building polygons matched, unchanged)
    -- ====================================================================
    SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(jsonb_agg(
            jsonb_build_object(
                'type', 'Feature',
                'id', ca.id,
                'geometry', ST_AsGeoJSON(ca.geom)::jsonb,
                'properties', jsonb_build_object(
                    'id', ca.id,
                    'feature_id', ca.id,
                    'address_id', ca.id,
                    'address_text', ca.formatted,
                    'height', 10,
                    'height_m', 10,
                    'status', CASE WHEN ca.visited THEN 'visited' ELSE 'not_visited' END,
                    'scans_total', COALESCE(ca.scans, 0),
                    'qr_scanned', COALESCE(ca.scans, 0) > 0,
                    'source', 'address_point'
                )
            )
        ), '[]'::jsonb)
    ) INTO result
    FROM campaign_addresses ca
    WHERE ca.campaign_id = p_campaign_id
      AND ca.geom IS NOT NULL;

    RETURN result;
END;
$$;

-- Keep the alias in sync
CREATE OR REPLACE FUNCTION public.get_campaign_buildings_geojson(
    p_campaign_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
    RETURN public.rpc_get_campaign_full_features(p_campaign_id);
END;
$$;

SELECT 'Gold dedup multi-address fix applied' AS status;
