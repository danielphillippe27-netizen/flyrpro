-- Debug script: Check why scanned QR codes aren't showing yellow on the map
-- Run these queries in Supabase SQL Editor one by one

-- 1. Check if building_stats has ANY records
SELECT 'building_stats count' as check_name, COUNT(*) as result FROM building_stats;

-- 2. Check building_stats records (show what's there)
SELECT * FROM building_stats LIMIT 10;

-- 3. Find addresses that have been scanned (scan_count > 0)
SELECT 
  id, 
  address, 
  formatted,
  gers_id as address_gers_id,
  scan_count,
  campaign_id
FROM campaign_addresses 
WHERE scan_count > 0 
LIMIT 10;

-- 4. For scanned addresses, check if they have building links
SELECT 
  ca.id as address_id,
  ca.formatted as address,
  ca.gers_id as address_gers_id,
  ca.scan_count,
  l.building_id,
  b.gers_id as building_gers_id,
  bs.scans_total as building_stats_scans
FROM campaign_addresses ca
LEFT JOIN building_address_links l ON l.address_id = ca.id
LEFT JOIN buildings b ON b.id = l.building_id
LEFT JOIN building_stats bs ON bs.gers_id = b.gers_id
WHERE ca.scan_count > 0
LIMIT 10;

-- 5. Check if the RPC returns qr_scanned for any features
-- Replace 'YOUR_CAMPAIGN_ID' with your actual campaign ID
/*
SELECT 
  (f->>'address_text') as address,
  (f->>'gers_id') as gers_id,
  (f->>'scans_total')::int as scans_total,
  (f->>'qr_scanned')::boolean as qr_scanned
FROM (
  SELECT jsonb_array_elements(rpc_get_campaign_full_features('YOUR_CAMPAIGN_ID'::uuid)->'features') as f
) sub
WHERE (f->>'scans_total')::int > 0 OR (f->>'qr_scanned')::boolean = true
LIMIT 10;
*/
