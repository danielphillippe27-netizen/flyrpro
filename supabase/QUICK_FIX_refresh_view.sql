-- QUICK FIX: Run this in Supabase SQL Editor to refresh the view
-- This will add qr_code_base64 and purl columns to the campaign_addresses_geojson view

-- Drop the existing view if it exists
DROP VIEW IF EXISTS public.campaign_addresses_geojson;

-- Recreate the view with all columns including qr_code_base64
CREATE VIEW public.campaign_addresses_geojson AS
SELECT 
  id,
  campaign_id,
  address,
  formatted,
  postal_code,
  source,
  source_id,
  seq,
  visited,
  coordinate,
  geom,
  building_outline,
  road_bearing,
  house_bearing,
  street_name,
  is_oriented,
  orientation_locked,
  scans,
  last_scanned_at,
  qr_code_base64,  -- NEW: Include QR code base64
  purl,            -- NEW: Include tracking URL
  created_at,
  -- Convert geom to GeoJSON format if geom exists
  CASE 
    WHEN geom IS NOT NULL THEN ST_AsGeoJSON(geom)::jsonb
    ELSE NULL
  END as geom_json
FROM public.campaign_addresses;

-- Verify the view was created
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'campaign_addresses_geojson' 
  AND column_name IN ('qr_code_base64', 'purl')
ORDER BY column_name;
