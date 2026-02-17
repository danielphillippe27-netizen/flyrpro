-- ============================================================================
-- GOLD STANDARD: Simple Spatial Linker (No Polygon Filter)
-- ============================================================================
-- Use this if the polygon-filtered version returns 0 matches
-- ============================================================================

DROP FUNCTION IF EXISTS public.link_campaign_addresses_gold(UUID);
DROP FUNCTION IF EXISTS public.link_campaign_addresses_gold(UUID, TEXT);

-- Simple version without polygon filter
CREATE OR REPLACE FUNCTION public.link_campaign_addresses_gold(
  p_campaign_id UUID,
  p_polygon_geojson TEXT DEFAULT NULL  -- Ignored in this version
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
BEGIN
  -- 1. Exact matches: Address inside Building polygon
  UPDATE campaign_addresses ca
  SET 
    building_id = b.id,
    match_source = 'gold_exact',
    confidence = 1.0
  FROM ref_buildings_gold b
  WHERE ca.campaign_id = p_campaign_id
    AND ca.building_id IS NULL
    AND ST_Covers(b.geom, ca.geom);

  GET DIAGNOSTICS v_exact = ROW_COUNT;

  -- 2. Proximity matches: Address within 30m of nearest Building
  UPDATE campaign_addresses ca
  SET 
    building_id = nearest.building_id,
    match_source = 'gold_proximity',
    confidence = GREATEST(0.5, 1.0 - (nearest.dist / 60))
  FROM (
    SELECT DISTINCT ON (ca2.id)
      ca2.id as address_id,
      b.id as building_id,
      ST_Distance(ca2.geom::geography, b.geom::geography) as dist
    FROM campaign_addresses ca2
    JOIN ref_buildings_gold b 
      ON ST_DWithin(b.geom::geography, ca2.geom::geography, 30)
    WHERE ca2.campaign_id = p_campaign_id
      AND ca2.building_id IS NULL
    ORDER BY ca2.id, ST_Distance(b.geom::geography, ca2.geom::geography)
  ) nearest
  WHERE ca.id = nearest.address_id
    AND ca.building_id IS NULL;

  GET DIAGNOSTICS v_proximity = ROW_COUNT;

  RETURN QUERY SELECT v_exact, v_proximity, v_exact + v_proximity;
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_campaign_addresses_gold(UUID, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.link_campaign_addresses_gold(UUID, TEXT) IS 
'Links campaign addresses to Gold buildings. Simple version without polygon filter.';

-- Verify
SELECT 'Simple Gold linker created' as status;
