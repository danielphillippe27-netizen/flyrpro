-- Refresh campaign_addresses_geojson view to include qr_code_base64 column
-- This view is used by CampaignsService.fetchAddresses()

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

-- Add comment for documentation
COMMENT ON VIEW public.campaign_addresses_geojson IS 'View of campaign_addresses with GeoJSON geometry conversion. Includes qr_code_base64 and purl columns for QR code functionality.';
