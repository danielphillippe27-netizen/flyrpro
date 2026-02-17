-- ============================================================================
-- DIAGNOSTIC: Check Gold Standard Link Status
-- ============================================================================
-- Run this in Supabase SQL Editor to verify links were created
-- ============================================================================

-- 1. Check if campaign_addresses has building_id column
SELECT 
  column_name, 
  data_type 
FROM information_schema.columns 
WHERE table_name = 'campaign_addresses' 
  AND column_name = 'building_id';

-- 2. Check for any linked addresses (should show 299 for recent campaigns)
SELECT 
  ca.campaign_id,
  COUNT(*) as total_addresses,
  COUNT(ca.building_id) as linked_addresses,
  COUNT(*) - COUNT(ca.building_id) as unlinked_addresses
FROM campaign_addresses ca
WHERE ca.created_at > NOW() - INTERVAL '1 hour'
GROUP BY ca.campaign_id
ORDER BY ca.campaign_id DESC
LIMIT 5;

-- 3. Check specific campaign (replace with your campaign ID)
-- SELECT 
--   ca.id as address_id,
--   ca.formatted,
--   ca.building_id,
--   ca.match_source,
--   ca.confidence
-- FROM campaign_addresses ca
-- WHERE ca.campaign_id = 'YOUR-CAMPAIGN-ID-HERE'
-- ORDER BY ca.building_id NULLS LAST
-- LIMIT 20;

-- 4. Check if addresses and buildings spatially intersect
-- SELECT 
--   ca.id,
--   ca.formatted,
--   b.id as building_id,
--   ST_Distance(ca.geom::geography, b.geom::geography) as distance_meters
-- FROM campaign_addresses ca
-- CROSS JOIN LATERAL (
--   SELECT b.id, b.geom
--   FROM ref_buildings_gold b
--   WHERE ST_DWithin(b.geom::geography, ca.geom::geography, 50)
--   ORDER BY b.geom <-> ca.geom
--   LIMIT 1
-- ) b
-- WHERE ca.campaign_id = 'YOUR-CAMPAIGN-ID-HERE'
-- LIMIT 10;
