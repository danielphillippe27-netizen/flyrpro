-- Populate building_stats from existing scanned addresses
-- The old scan API couldn't find buildings (address GERS ≠ building GERS),
-- so building_stats was never populated. This migration backfills it.

-- Insert building_stats records for all addresses that have been scanned
-- Uses the stable linker (building_address_links) to find the correct building
INSERT INTO public.building_stats (gers_id, campaign_id, scans_total, scans_today, status, last_scan_at)
SELECT 
  b.gers_id,
  ca.campaign_id,
  ca.scans,  -- Total scans from the address
  ca.scans,  -- Assume all scans were today (approximation)
  'visited',
  COALESCE(ca.last_scanned_at, now())
FROM public.campaign_addresses ca
JOIN public.building_address_links l ON l.address_id = ca.id
JOIN public.buildings b ON b.id = l.building_id
WHERE ca.scans > 0
  AND b.gers_id IS NOT NULL
ON CONFLICT (gers_id) DO UPDATE SET
  scans_total = building_stats.scans_total + EXCLUDED.scans_total,
  scans_today = EXCLUDED.scans_today,
  status = 'visited',
  last_scan_at = COALESCE(EXCLUDED.last_scan_at, building_stats.last_scan_at);

-- Log how many records were affected
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM building_stats;
  RAISE NOTICE 'building_stats now has % records', v_count;
END $$;
