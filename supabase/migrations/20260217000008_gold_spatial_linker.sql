-- ============================================================================
-- GOLD STANDARD: Fast SQL-based Spatial Linker
-- ============================================================================
-- Uses PostGIS spatial indexes for O(1) performance vs O(n²) in JavaScript
-- Handles MultiPolygon natively, no code changes needed
-- ============================================================================

-- Add building_id and match columns to campaign_addresses if not exist
ALTER TABLE campaign_addresses 
  ADD COLUMN IF NOT EXISTS building_id UUID,
  ADD COLUMN IF NOT EXISTS match_source TEXT,
  ADD COLUMN IF NOT EXISTS confidence FLOAT;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_campaign_addresses_building_id 
  ON campaign_addresses(campaign_id, building_id);

-- Fast SQL-based spatial linker for Gold data
CREATE OR REPLACE FUNCTION public.link_campaign_addresses_gold(p_campaign_id uuid)
RETURNS TABLE (
  exact_matches bigint,
  proximity_matches bigint,
  total_linked bigint
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_exact bigint;
  v_proximity bigint;
BEGIN
  -- 1. Link exact matches (Address inside Building polygon)
  -- Uses spatial index on ref_buildings_gold.geom for O(log n) lookups
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

  -- 2. Link proximity matches (Address within 10m of Building centroid)
  -- Only for addresses not matched in step 1
  WITH nearest_buildings AS (
    SELECT DISTINCT ON (ca.id)
      ca.id as address_id,
      b.id as building_id,
      ST_Distance(b.centroid::geography, ca.geom::geography) as distance
    FROM campaign_addresses ca
    CROSS JOIN LATERAL (
      SELECT b.id, b.centroid
      FROM ref_buildings_gold b
      WHERE ca.campaign_id = p_campaign_id
        AND ca.building_id IS NULL
        AND ST_DWithin(b.centroid::geography, ca.geom::geography, 10)
      ORDER BY b.centroid <-> ca.geom
      LIMIT 1
    ) b
    WHERE ca.campaign_id = p_campaign_id
      AND ca.building_id IS NULL
  )
  UPDATE campaign_addresses ca
  SET 
    building_id = nb.building_id,
    match_source = 'gold_proximity',
    confidence = GREATEST(0.5, 1.0 - (nb.distance / 20)) -- Decay confidence with distance
  FROM nearest_buildings nb
  WHERE ca.id = nb.address_id;

  GET DIAGNOSTICS v_proximity = ROW_COUNT;

  RETURN QUERY SELECT v_exact, v_proximity, v_exact + v_proximity;
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_campaign_addresses_gold(UUID) TO authenticated, service_role;

-- Verify
SELECT 'Gold spatial linker function created' as status;
