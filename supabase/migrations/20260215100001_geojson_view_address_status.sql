-- Expose address_status in campaign_addresses_geojson for address-based map coloring.

DROP VIEW IF EXISTS public.campaign_addresses_geojson;

CREATE VIEW public.campaign_addresses_geojson AS
SELECT
  ca.id,
  ca.campaign_id,
  ca.formatted AS address,
  ca.formatted,
  ca.postal_code,
  ca.source,
  ca.source_id,
  ca.seq,
  ca.visited,
  ca.coordinate,
  ca.geom,
  ca.building_outline,
  ca.road_bearing,
  ca.house_bearing,
  ca.street_name,
  ca.house_number,
  ca.is_oriented,
  ca.orientation_locked,
  COALESCE(ca.scans, 0) AS scans,
  ca.last_scanned_at,
  ca.qr_code_base64,
  ca.purl,
  ca.created_at,
  ca.cluster_id,
  ca.sequence,
  ca.walk_time_sec,
  ca.distance_m,
  COALESCE(ast.status, 'none') AS address_status,
  CASE
    WHEN ca.geom IS NOT NULL THEN ST_AsGeoJSON(ca.geom)::jsonb
    ELSE NULL
  END AS geom_json
FROM public.campaign_addresses ca
LEFT JOIN public.address_statuses ast ON ast.campaign_address_id = ca.id;

COMMENT ON VIEW public.campaign_addresses_geojson IS 'View of campaign_addresses with GeoJSON geometry, CVRP route columns, and address_status (from address_statuses) for map coloring.';
