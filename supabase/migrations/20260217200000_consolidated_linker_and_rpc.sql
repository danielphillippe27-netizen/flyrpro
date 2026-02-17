-- ============================================================================
-- CONSOLIDATED: Polygon-scoped linker + fast feature RPC
-- Handles BOTH Gold (ref_buildings_gold) and Silver/GERS (buildings) tables.
-- Replaces 18 conflicting migrations; no spatial ops at read time (no timeout).
-- ============================================================================

-- 0. INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_ref_buildings_gold_geom ON ref_buildings_gold USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_ref_buildings_gold_centroid ON ref_buildings_gold USING GIST (centroid);
CREATE INDEX IF NOT EXISTS idx_buildings_geom ON buildings USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_buildings_centroid ON buildings USING GIST (centroid);
CREATE INDEX IF NOT EXISTS idx_campaign_addresses_geom ON campaign_addresses USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_campaign_addresses_campaign_id ON campaign_addresses(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_addresses_building_id ON campaign_addresses(campaign_id, building_id);
CREATE INDEX IF NOT EXISTS idx_building_address_links_campaign_id ON building_address_links(campaign_id);
CREATE INDEX IF NOT EXISTS idx_building_address_links_building_id ON building_address_links(building_id);

-- Ensure columns exist on campaign_addresses (Gold linker writes here)
ALTER TABLE campaign_addresses ADD COLUMN IF NOT EXISTS building_id UUID;
ALTER TABLE campaign_addresses ADD COLUMN IF NOT EXISTS match_source TEXT;
ALTER TABLE campaign_addresses ADD COLUMN IF NOT EXISTS confidence FLOAT;

-- ============================================================================
-- 1. LINKER: Link campaign addresses to buildings within campaign polygon
--    Tries Gold first, then Silver/GERS. All scoped to polygon.
-- ============================================================================
DROP FUNCTION IF EXISTS public.link_campaign_addresses_gold(UUID, TEXT);
DROP FUNCTION IF EXISTS public.link_campaign_addresses_gold(UUID);

CREATE OR REPLACE FUNCTION public.link_campaign_addresses_all(
    p_campaign_id UUID
)
RETURNS TABLE (
    gold_exact   BIGINT,
    gold_prox    BIGINT,
    silver_exact BIGINT,
    silver_prox  BIGINT,
    total_linked BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_gold_exact   BIGINT := 0;
    v_gold_prox    BIGINT := 0;
    v_silver_exact BIGINT := 0;
    v_silver_prox  BIGINT := 0;
    v_poly         GEOMETRY;
BEGIN
    -- Get campaign polygon: territory_boundary is GEOMETRY; snapped/raw are JSONB
    SELECT COALESCE(
        territory_boundary,
        ST_GeomFromGeoJSON(campaign_polygon_snapped::text)::GEOMETRY,
        ST_GeomFromGeoJSON(campaign_polygon_raw::text)::GEOMETRY
    ) INTO v_poly
    FROM campaigns WHERE id = p_campaign_id;

    IF v_poly IS NULL THEN
        SELECT ST_ConvexHull(ST_Collect(ca.geom)) INTO v_poly
        FROM campaign_addresses ca
        WHERE ca.campaign_id = p_campaign_id AND ca.geom IS NOT NULL;
    END IF;

    IF v_poly IS NULL THEN
        RETURN QUERY SELECT 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT;
        RETURN;
    END IF;

    -- Buffer polygon 100m to catch buildings on the edge
    v_poly := ST_Buffer(v_poly::GEOGRAPHY, 100)::GEOMETRY;

    -- ============================
    -- GOLD: ref_buildings_gold -> campaign_addresses.building_id
    -- ============================

    -- Gold exact: address point inside building polygon
    UPDATE campaign_addresses ca
    SET building_id = b.id,
        match_source = 'gold_exact',
        confidence = 1.0
    FROM ref_buildings_gold b
    WHERE ca.campaign_id = p_campaign_id
      AND ca.building_id IS NULL
      AND ca.geom IS NOT NULL
      AND b.geom && v_poly
      AND b.geom && ca.geom
      AND ST_Covers(b.geom, ca.geom);

    GET DIAGNOSTICS v_gold_exact = ROW_COUNT;

    -- Gold proximity: nearest building within 30m
    UPDATE campaign_addresses ca
    SET building_id = sub.building_id,
        match_source = 'gold_proximity',
        confidence = GREATEST(0.5, 1.0 - (sub.dist / 60.0))
    FROM (
        SELECT
            ca2.id   AS address_id,
            nearest.id AS building_id,
            nearest.dist
        FROM campaign_addresses ca2
        CROSS JOIN LATERAL (
            SELECT b.id,
                   ST_Distance(ca2.geom::geography, b.geom::geography) AS dist
            FROM ref_buildings_gold b
            WHERE b.geom && v_poly
              AND b.geom && ST_Expand(ca2.geom, 0.0003)
              AND ST_DWithin(b.geom::geography, ca2.geom::geography, 30)
            ORDER BY b.geom <-> ca2.geom
            LIMIT 1
        ) nearest
        WHERE ca2.campaign_id = p_campaign_id
          AND ca2.building_id IS NULL
          AND ca2.geom IS NOT NULL
    ) sub
    WHERE ca.id = sub.address_id;

    GET DIAGNOSTICS v_gold_prox = ROW_COUNT;

    -- ============================
    -- SILVER/GERS: buildings -> building_address_links (building_id = gers_id TEXT)
    -- ============================

    -- Silver exact: address inside GERS building polygon
    INSERT INTO building_address_links (campaign_id, address_id, building_id, match_type, confidence, distance_meters)
    SELECT
        p_campaign_id,
        ca.id,
        b.gers_id,
        'containment_verified',
        1.0,
        0
    FROM campaign_addresses ca
    JOIN buildings b
      ON b.geom && v_poly
     AND b.geom && ca.geom
     AND ST_Covers(b.geom, ca.geom)
    WHERE ca.campaign_id = p_campaign_id
      AND ca.building_id IS NULL
      AND ca.geom IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM building_address_links bal
          WHERE bal.campaign_id = p_campaign_id AND bal.address_id = ca.id
      )
    ON CONFLICT (campaign_id, address_id) DO NOTHING;

    GET DIAGNOSTICS v_silver_exact = ROW_COUNT;

    -- Silver proximity: nearest GERS building within 30m
    INSERT INTO building_address_links (campaign_id, address_id, building_id, match_type, confidence, distance_meters)
    SELECT
        p_campaign_id,
        sub.address_id,
        sub.gers_id,
        'proximity_verified',
        GREATEST(0.5, 1.0 - (sub.dist / 60.0)),
        sub.dist
    FROM (
        SELECT
            ca.id AS address_id,
            nearest.gers_id,
            nearest.dist
        FROM campaign_addresses ca
        CROSS JOIN LATERAL (
            SELECT b.gers_id,
                   ST_Distance(ca.geom::geography, b.geom::geography) AS dist
            FROM buildings b
            WHERE b.geom && v_poly
              AND b.geom && ST_Expand(ca.geom, 0.0003)
              AND ST_DWithin(b.geom::geography, ca.geom::geography, 30)
            ORDER BY b.geom <-> ca.geom
            LIMIT 1
        ) nearest
        WHERE ca.campaign_id = p_campaign_id
          AND ca.building_id IS NULL
          AND ca.geom IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM building_address_links bal
              WHERE bal.campaign_id = p_campaign_id AND bal.address_id = ca.id
          )
    ) sub
    ON CONFLICT (campaign_id, address_id) DO NOTHING;

    GET DIAGNOSTICS v_silver_prox = ROW_COUNT;

    RETURN QUERY SELECT v_gold_exact, v_gold_prox, v_silver_exact, v_silver_prox,
                        v_gold_exact + v_gold_prox + v_silver_exact + v_silver_prox;
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_campaign_addresses_all(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.link_campaign_addresses_all(UUID) IS
'Links campaign addresses to Gold and Silver buildings within campaign polygon. Run once per campaign after addresses exist.';

-- ============================================================================
-- 2. FEATURE RPC: Return linked buildings as GeoJSON (NO spatial joins)
--    Priority: Gold pre-linked -> Silver/GERS pre-linked -> Address points
-- ============================================================================
DROP FUNCTION IF EXISTS public.rpc_get_campaign_full_features(UUID);
DROP FUNCTION IF EXISTS public.get_campaign_buildings_geojson(UUID);

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
    -- Gold path: campaign_addresses.building_id -> ref_buildings_gold
    SELECT COUNT(*) INTO v_gold_count
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
                'id', ca.id,
                'geometry', ST_AsGeoJSON(b.geom)::jsonb,
                'properties', jsonb_build_object(
                    'id', b.id,
                    'feature_id', ca.id,
                    'building_id', b.id,
                    'gers_id', b.id,
                    'address_id', ca.id,
                    'address_text', ca.formatted,
                    'house_number', ca.house_number,
                    'street_name', ca.street_name,
                    'height', COALESCE(b.height_m, 10),
                    'height_m', COALESCE(b.height_m, 10),
                    'min_height', 0,
                    'feature_status', 'matched',
                    'feature_type', 'matched_house',
                    'match_method', COALESCE(ca.match_source, 'gold_exact'),
                    'confidence', COALESCE(ca.confidence, 1.0),
                    'status', CASE WHEN ca.visited THEN 'visited' ELSE 'not_visited' END,
                    'scans_total', COALESCE(ca.scans, 0),
                    'qr_scanned', COALESCE(ca.scans, 0) > 0,
                    'source', 'gold'
                )
            ) AS feature
            FROM campaign_addresses ca
            JOIN ref_buildings_gold b ON b.id = ca.building_id
            WHERE ca.campaign_id = p_campaign_id
              AND ca.building_id IS NOT NULL
        ) f;

        RETURN result;
    END IF;

    -- Silver path: building_address_links.building_id (TEXT) = buildings.gers_id
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

    -- Fallback: address points (no building polygons matched)
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

GRANT EXECUTE ON FUNCTION public.rpc_get_campaign_full_features(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.rpc_get_campaign_full_features(UUID) IS
'Returns GeoJSON for map. Gold path uses campaign_addresses.building_id; Silver uses building_address_links. No spatial ops at read time.';

-- API alias
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

GRANT EXECUTE ON FUNCTION public.get_campaign_buildings_geojson(UUID) TO authenticated, service_role;

-- Verify
SELECT 'Consolidated linker + feature RPC created' AS status;
