BEGIN;

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS has_parcels BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS building_link_confidence DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS map_mode TEXT
    CHECK (map_mode IN ('smart_buildings', 'hybrid', 'standard_pins')),
  ADD COLUMN IF NOT EXISTS provision_source TEXT
    CHECK (provision_source IN ('gold', 'silver', 'lambda')),
  ADD COLUMN IF NOT EXISTS provision_phase TEXT DEFAULT 'created'
    CHECK (provision_phase IN ('created', 'source_probed', 'addresses_loading', 'addresses_ready', 'map_ready', 'optimizing', 'optimized', 'failed')),
  ADD COLUMN IF NOT EXISTS addresses_ready_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS map_ready_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS optimized_at TIMESTAMPTZ;

UPDATE public.campaigns
SET
  provision_phase = CASE
    WHEN provision_status = 'ready' THEN 'optimized'
    WHEN provision_status = 'failed' THEN 'failed'
    ELSE 'created'
  END,
  has_parcels = COALESCE(has_parcels, FALSE),
  building_link_confidence = COALESCE(building_link_confidence, 0),
  map_mode = COALESCE(map_mode, 'standard_pins'),
  addresses_ready_at = CASE
    WHEN provision_status = 'ready' THEN COALESCE(addresses_ready_at, provisioned_at, updated_at)
    ELSE addresses_ready_at
  END,
  map_ready_at = CASE
    WHEN provision_status = 'ready' THEN COALESCE(map_ready_at, provisioned_at, updated_at)
    ELSE map_ready_at
  END,
  optimized_at = CASE
    WHEN provision_status = 'ready' THEN COALESCE(optimized_at, provisioned_at, updated_at)
    ELSE optimized_at
  END
WHERE
  provision_phase IS NULL
  OR provision_phase = 'created'
  OR has_parcels IS NULL
  OR building_link_confidence IS NULL
  OR map_mode IS NULL
  OR (
    provision_status = 'ready'
    AND (addresses_ready_at IS NULL OR map_ready_at IS NULL OR optimized_at IS NULL)
  )
  OR (
    provision_status = 'failed'
    AND provision_phase <> 'failed'
  );

COMMENT ON COLUMN public.campaigns.provision_source IS
'Resolved provisioning data source for the campaign: gold, silver, or lambda.';

COMMENT ON COLUMN public.campaigns.provision_phase IS
'Fine-grained provisioning lifecycle phase. provision_status remains the backward-compatible ready/failed gate.';

COMMENT ON COLUMN public.campaigns.addresses_ready_at IS
'Timestamp when campaign addresses were fully hydrated into campaign_addresses.';

COMMENT ON COLUMN public.campaigns.map_ready_at IS
'Timestamp when the campaign became map-ready (addresses loaded and buildings fetchable).';

COMMENT ON COLUMN public.campaigns.optimized_at IS
'Timestamp when background optimization, linking, and parcel work finished.';

CREATE OR REPLACE FUNCTION public.hydrate_campaign_gold_addresses(
  p_campaign_id UUID,
  p_polygon_geojson TEXT,
  p_province TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 5000
)
RETURNS TABLE (
  inserted_count INTEGER,
  source_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $hydrate_campaign_gold_addresses$
DECLARE
  v_polygon geometry;
  v_province text;
  v_source_count integer := 0;
  v_inserted_count integer := 0;
BEGIN
  v_polygon := ST_GeomFromGeoJSON(p_polygon_geojson)::geometry(Polygon, 4326);
  v_province := NULLIF(UPPER(TRIM(p_province)), '');

  SELECT COUNT(*)
  INTO v_source_count
  FROM (
    SELECT 1
    FROM public.ref_addresses_gold a
    WHERE ST_Within(a.geom, v_polygon)
      AND (v_province IS NULL OR UPPER(a.province) = v_province)
    LIMIT GREATEST(p_limit, 0)
  ) src;

  IF v_source_count = 0 THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  INSERT INTO public.campaign_addresses (
    campaign_id,
    formatted,
    house_number,
    street_name,
    locality,
    region,
    postal_code,
    geom,
    source
  )
  SELECT
    p_campaign_id,
    TRIM(
      BOTH ', '
      FROM CONCAT_WS(
        ', ',
        NULLIF(TRIM(CONCAT_WS(' ', a.street_number, a.street_name, a.unit)), ''),
        NULLIF(TRIM(a.city), '')
      )
    ),
    a.street_number,
    a.street_name,
    a.city,
    NULLIF(UPPER(TRIM(a.province)), ''),
    a.zip,
    a.geom,
    'gold'
  FROM public.ref_addresses_gold a
  WHERE ST_Within(a.geom, v_polygon)
    AND (v_province IS NULL OR UPPER(a.province) = v_province)
  ORDER BY a.street_name, a.street_number_normalized NULLS LAST, a.street_number
  LIMIT GREATEST(p_limit, 0);

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  RETURN QUERY SELECT v_inserted_count, v_source_count;
END;
$hydrate_campaign_gold_addresses$;

GRANT EXECUTE ON FUNCTION public.hydrate_campaign_gold_addresses(UUID, TEXT, TEXT, INTEGER)
TO authenticated, service_role;

COMMENT ON FUNCTION public.hydrate_campaign_gold_addresses(UUID, TEXT, TEXT, INTEGER) IS
'Bulk hydrates campaign_addresses directly from ref_addresses_gold for a polygon-scoped Gold campaign.';

COMMIT;
