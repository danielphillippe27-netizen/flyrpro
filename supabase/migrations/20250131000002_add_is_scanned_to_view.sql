-- Add is_scanned property to campaign_addresses_geojson view
-- This enables frontend to check scan status directly from the view

DROP VIEW IF EXISTS public.campaign_addresses_geojson;

CREATE VIEW public.campaign_addresses_geojson AS
SELECT 
  id,
  campaign_id,
  formatted AS address,  -- alias formatted → address for backward compatibility
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
  -- NEW: Boolean flag for scan status (true if QR code has been scanned)
  CASE 
    WHEN scans > 0 OR last_scanned_at IS NOT NULL THEN true 
    ELSE false 
  END AS is_scanned,
  qr_code_base64,
  purl,
  created_at,
  CASE 
    WHEN geom IS NOT NULL THEN ST_AsGeoJSON(geom)::jsonb
    ELSE NULL
  END as geom_json
FROM public.campaign_addresses;

COMMENT ON VIEW public.campaign_addresses_geojson IS 
'View of campaign_addresses with GeoJSON geometry. Includes is_scanned boolean for QR code scan status. Maps formatted→address for backward compatibility.';

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
