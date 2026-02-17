-- ============================================================================
-- GOLD STANDARD: Polygon-filtered Spatial Linker (No Timeout)
-- ============================================================================
-- Passes the polygon to limit building search to relevant area only
-- ============================================================================

DROP FUNCTION IF EXISTS public.link_campaign_addresses_gold(UUID);
DROP FUNCTION IF EXISTS public.link_campaign_addresses_gold(UUID, TEXT);

-- Optimized spatial linker with polygon filter
CREATE OR REPLACE FUNCTION public.link_campaign_addresses_gold(
  p_campaign_id UUID,
  p_polygon_geojson TEXT DEFAULT NULL
)
RETURNS TABLE (
  exact_matches BIGINT,
  proximity_matches BIGINT,
  total_linked BIGINT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_exact BIGINT;
  v_proximity BIGINT;
  v_polygon GEOMETRY;
BEGIN
  -- Parse polygon if provided
  IF p_polygon_geojson IS NOT NULL THEN
    v_polygon := ST_GeomFromGeoJSON(p_polygon_geojson)::GEOMETRY(Polygon, 4326);
  END IF;

  -- 1. Exact matches: Address inside Building polygon
  -- Uses bounding box filter first (&& operator) for index usage
  UPDATE campaign_addresses ca
  SET 
    building_id = b.id,
    match_source = 'gold_exact',
    confidence = 1.0
  FROM ref_buildings_gold b
  WHERE ca.campaign_id = p_campaign_id
    AND ca.building_id IS NULL
    AND b.geom && ca.geom  -- Fast bounding box overlap (uses index)
    AND ST_Covers(b.geom, ca.geom)  -- Precise containment
    AND (v_polygon IS NULL OR ST_Intersects(b.geom, v_polygon));  -- Polygon filter

  GET DIAGNOSTICS v_exact = ROW_COUNT;

  -- 2. Proximity matches: Address within 30m of nearest unlinked Building
  -- Limited to buildings intersecting the polygon for performance
  UPDATE campaign_addresses ca
  SET 
    building_id = sub.building_id,
    match_source = 'gold_proximity',
    confidence = GREATEST(0.5, 1.0 - (sub.dist / 60))
  FROM (
    SELECT 
      ca2.id AS address_id,
      b.id AS building_id,
      ST_Distance(ca2.geom::geography, b.geom::geography) AS dist
    FROM campaign_addresses ca2
    CROSS JOIN LATERAL (
      SELECT b.id, b.geom
      FROM ref_buildings_gold b
      WHERE (v_polygon IS NULL OR ST_Intersects(b.geom, v_polygon))
        AND ST_DWithin(b.geom::geography, ca2.geom::geography, 30)
        AND b.geom && ST_Expand(ca2.geom, 0.0003)  -- ~30m in degrees, uses index
      ORDER BY b.geom <-> ca2.geom  -- Index-optimized nearest
      LIMIT 1
    ) b
    WHERE ca2.campaign_id = p_campaign_id
      AND ca2.building_id IS NULL
  ) sub
  WHERE ca.id = sub.address_id;

  GET DIAGNOSTICS v_proximity = ROW_COUNT;

  RETURN QUERY SELECT v_exact, v_proximity, v_exact + v_proximity;
END;
$$;

-- Ensure indexes exist
CREATE INDEX IF NOT EXISTS idx_ref_buildings_gold_geom ON ref_buildings_gold USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_campaign_addresses_geom ON campaign_addresses USING GIST (geom);

GRANT EXECUTE ON FUNCTION public.link_campaign_addresses_gold(UUID, TEXT) TO authenticated, service_role;

-- Verify
SELECT 'Polygon-filtered Gold linker created' as status;
