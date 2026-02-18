-- ============================================================================
-- ENRICH POSTAL CODES FROM GOLD STANDARD
-- ============================================================================
-- When silver/Overture addresses are missing postal codes, fall back to the
-- nearest Gold Standard address within ~50 m to fill in the zip/postal code.
-- Also exposes locality and region which the UI already reads.
-- ============================================================================

DROP VIEW IF EXISTS public.campaign_addresses_geojson;

CREATE VIEW public.campaign_addresses_geojson AS
SELECT
  ca.id,
  ca.campaign_id,
  ca.formatted AS address,
  ca.formatted,
  -- Enrich: prefer silver postal_code, fall back to nearest gold zip
  COALESCE(NULLIF(ca.postal_code, ''), gold_pc.zip) AS postal_code,
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
  ca.locality,
  ca.region,
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
LEFT JOIN public.address_statuses ast
  ON ast.campaign_address_id = ca.id
LEFT JOIN LATERAL (
  -- Find the closest Gold address within ~50 m (0.0005 degrees)
  SELECT rg.zip
  FROM ref_addresses_gold rg
  WHERE ca.geom IS NOT NULL
    AND ST_DWithin(rg.geom, ca.geom, 0.0005)
  ORDER BY ST_Distance(rg.geom, ca.geom)
  LIMIT 1
) gold_pc ON (ca.postal_code IS NULL OR ca.postal_code = '');

COMMENT ON VIEW public.campaign_addresses_geojson IS
  'Campaign addresses with GeoJSON geometry, CVRP route columns, address_status, '
  'and Gold-enriched postal codes when the silver source is missing them.';
