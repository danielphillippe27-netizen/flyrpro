-- Expose CVRP route columns in campaign_addresses_geojson so optimized routes
-- persist when the page is reloaded (fetchAddresses uses this view).

DROP VIEW IF EXISTS public.campaign_addresses_geojson;

CREATE VIEW public.campaign_addresses_geojson AS
SELECT
  id,
  campaign_id,
  formatted AS address,
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
  -- CVRP route optimization (so routes persist on reload)
  cluster_id,
  sequence,
  walk_time_sec,
  distance_m,
  -- GeoJSON geometry for map/route display
  CASE
    WHEN geom IS NOT NULL THEN ST_AsGeoJSON(geom)::jsonb
    ELSE NULL
  END AS geom_json
FROM public.campaign_addresses;

COMMENT ON VIEW public.campaign_addresses_geojson IS 'View of campaign_addresses with GeoJSON geometry and CVRP route columns (cluster_id, sequence, walk_time_sec, distance_m) so optimized routes persist when addresses are loaded.';
