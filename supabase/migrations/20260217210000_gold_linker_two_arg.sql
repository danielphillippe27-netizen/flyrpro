-- ============================================================================
-- FIX: Create link_campaign_addresses_gold(uuid, jsonb)
-- The provision route passes the polygon directly from the frontend,
-- which is faster than looking it up again from the campaigns table.
-- ============================================================================

-- Drop any old single-arg version to avoid ambiguity
DROP FUNCTION IF EXISTS public.link_campaign_addresses_gold(uuid);

-- Create the two-argument version that the provision route expects
CREATE OR REPLACE FUNCTION public.link_campaign_addresses_gold(
    p_campaign_id UUID,
    p_polygon_geojson JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_campaign_poly geometry;
BEGIN
    -- 1. Parse the polygon passed from the app
    v_campaign_poly := ST_SetSRID(ST_GeomFromGeoJSON(p_polygon_geojson), 4326);

    -- Buffer 100m to catch buildings on the edge (consistent with link_campaign_addresses_all)
    v_campaign_poly := ST_Buffer(v_campaign_poly::geography, 100)::geometry;

    -- 2. Link Exact Matches: address point inside building polygon
    UPDATE campaign_addresses ca
    SET building_id = b.id,
        match_source = 'gold_exact',
        confidence = 1.0
    FROM ref_buildings_gold b
    WHERE ca.campaign_id = p_campaign_id
      AND ca.building_id IS NULL
      AND ca.geom IS NOT NULL
      AND b.geom && v_campaign_poly
      AND b.geom && ca.geom
      AND ST_Covers(b.geom, ca.geom);

    -- 3. Link Proximity: nearest Gold building within 30m
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
            WHERE b.geom && v_campaign_poly
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
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_campaign_addresses_gold(UUID, JSONB) TO authenticated, service_role;

COMMENT ON FUNCTION public.link_campaign_addresses_gold(UUID, JSONB) IS
'Fast Gold linker: accepts campaign_id + polygon GeoJSON from frontend. Skips polygon lookup. Uses spatial index for O(log n) matching.';

-- Verify
SELECT 'link_campaign_addresses_gold(uuid, jsonb) created' AS status;
