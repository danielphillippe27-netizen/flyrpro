-- Fix campaign_addresses_geojson view and add missing columns
-- Based on actual schema inspection on 2025-01-29
-- Errors: "column address does not exist", "column scans does not exist"

-- Step 1: Add ONLY the missing columns (verified against actual schema)
ALTER TABLE public.campaign_addresses ADD COLUMN IF NOT EXISTS scans INTEGER DEFAULT 0;
ALTER TABLE public.campaign_addresses ADD COLUMN IF NOT EXISTS last_scanned_at TIMESTAMPTZ;
ALTER TABLE public.campaign_addresses ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE public.campaign_addresses ADD COLUMN IF NOT EXISTS coordinate JSONB;
ALTER TABLE public.campaign_addresses ADD COLUMN IF NOT EXISTS building_outline JSONB;

-- Step 2: Drop and recreate the view with correct column names
-- Key fix: 'formatted' is aliased as 'address' for backward compatibility
DROP VIEW IF EXISTS public.campaign_addresses_geojson;

CREATE VIEW public.campaign_addresses_geojson AS
SELECT 
  id,
  campaign_id,
  formatted AS address,  -- KEY FIX: alias formatted → address
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
  house_number,
  is_oriented,
  orientation_locked,
  COALESCE(scans, 0) AS scans,
  last_scanned_at,
  qr_code_base64,
  purl,
  created_at,
  CASE 
    WHEN geom IS NOT NULL THEN ST_AsGeoJSON(geom)::jsonb
    ELSE NULL
  END as geom_json
FROM public.campaign_addresses;

COMMENT ON VIEW public.campaign_addresses_geojson IS 'View of campaign_addresses with GeoJSON geometry. Maps formatted→address for backward compatibility.';

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
