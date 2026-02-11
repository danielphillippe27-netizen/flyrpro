-- Fix existing building_stats records that were created with address GERS IDs instead of building GERS IDs
-- The scan API was incorrectly using campaign_addresses.gers_id (address GERS) instead of
-- the linked building's gers_id (building GERS) when updating building_stats.
-- This migration fixes existing records by looking up the correct building GERS ID through the stable linker.

-- Step 1: Update building_stats where we can find the correct building through address matching
-- This matches building_stats.gers_id to campaign_addresses.gers_id and then finds the linked building
WITH stats_to_fix AS (
  -- Find building_stats records that have an address GERS ID instead of building GERS ID
  -- These are records where gers_id matches a campaign_addresses.gers_id but NOT a buildings.gers_id
  SELECT 
    bs.gers_id AS old_gers_id,
    b.gers_id AS correct_building_gers_id,
    bs.campaign_id,
    bs.scans_total,
    bs.scans_today,
    bs.status,
    bs.last_scan_at
  FROM public.building_stats bs
  JOIN public.campaign_addresses ca ON ca.gers_id = bs.gers_id
  JOIN public.building_address_links l ON l.address_id = ca.id
  JOIN public.buildings b ON b.id = l.building_id
  WHERE b.gers_id IS NOT NULL
    AND b.gers_id != bs.gers_id  -- Only fix if the building GERS ID is different
)
-- Insert/update the correct building_stats records
INSERT INTO public.building_stats (gers_id, campaign_id, scans_total, scans_today, status, last_scan_at)
SELECT 
  correct_building_gers_id,
  campaign_id,
  scans_total,
  scans_today,
  status,
  last_scan_at
FROM stats_to_fix
ON CONFLICT (gers_id) DO UPDATE SET
  scans_total = building_stats.scans_total + EXCLUDED.scans_total,
  scans_today = EXCLUDED.scans_today,
  status = EXCLUDED.status,
  last_scan_at = COALESCE(EXCLUDED.last_scan_at, building_stats.last_scan_at);

-- Step 2: Delete the old records that had address GERS IDs
-- Only delete if the gers_id doesn't match any building
DELETE FROM public.building_stats bs
WHERE NOT EXISTS (
  SELECT 1 FROM public.buildings b WHERE b.gers_id = bs.gers_id
)
AND EXISTS (
  -- Make sure we're only deleting records that had address GERS IDs
  SELECT 1 FROM public.campaign_addresses ca WHERE ca.gers_id = bs.gers_id
);

-- Add a comment explaining the fix
COMMENT ON TABLE public.building_stats IS 
'Stores scan statistics per building (by building GERS ID). Updated by QR scan API. 
Note: gers_id should always be the building GERS ID from the buildings table, NOT the address GERS ID.
Migration 20250131000030 fixed existing records that had address GERS IDs.';
