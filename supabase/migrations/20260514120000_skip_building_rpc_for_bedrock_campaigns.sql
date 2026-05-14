-- Skip legacy building aggregation in rpc_get_campaign_map_bundle for
-- Diamond/Bedrock-provisioned campaigns.
--
-- The legacy Gold building RPC, rpc_get_campaign_full_features, can scan
-- ref_buildings_gold by campaign territory and build inline GeoJSON. That is
-- appropriate for legacy Gold/Silver database-backed campaigns, but it times
-- out for Bedrock campaigns whose buildings are produced as PMTiles artifacts.
-- Diamond/Bedrock buildings are rendered through the frontend manifest path
-- and PMTiles artifacts instead of this bundle RPC.
--
-- This migration updates only rpc_get_campaign_map_bundle. It does not change
-- rpc_get_campaign_full_features or get_campaign_buildings_geojson, which are
-- still used by legacy callers and iOS-coupled paths.

CREATE OR REPLACE FUNCTION public.rpc_get_campaign_map_bundle(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign record;
  v_addresses jsonb := jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb);
  v_buildings jsonb := jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb);
  v_parcels jsonb := jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb);
  v_roads jsonb := jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb);
  v_address_count integer := 0;
  v_building_count integer := 0;
  v_parcel_count integer := 0;
  v_road_count integer := 0;
  v_updated_at timestamptz;
BEGIN
  SELECT
    c.id,
    c.provision_status,
    c.provision_phase,
    c.provision_source,
    c.region,
    c.updated_at,
    c.addresses_ready_at,
    c.map_ready_at,
    c.optimized_at
  INTO v_campaign
  FROM public.campaigns c
  WHERE c.id = p_campaign_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'campaign_id', p_campaign_id,
      'status', 'not_found',
      'phase', 'not_found',
      'map_ready', false,
      'addresses', v_addresses,
      'buildings', v_buildings,
      'parcels', v_parcels,
      'roads', v_roads,
      'counts', jsonb_build_object('addresses', 0, 'buildings', 0, 'parcels', 0, 'roads', 0),
      'updated_at', now()
    );
  END IF;

  BEGIN
    v_addresses := COALESCE(public.rpc_get_campaign_addresses(p_campaign_id), v_addresses);
  EXCEPTION WHEN OTHERS THEN
    v_addresses := jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb);
  END;

  IF v_campaign.provision_source NOT IN (
    'diamond', 'bedrock_ca', 'bedrock_us', 'bedrock_au',
    'bedrock_nz', 'bedrock_za', 'bedrock_uk'
  ) THEN
    -- Only run Gold building RPC for legacy provision sources.
    BEGIN
      v_buildings := COALESCE(
        public.rpc_get_campaign_full_features(p_campaign_id),
        v_buildings
      );
      IF v_buildings IS NULL THEN
        v_buildings := COALESCE(
          public.get_campaign_buildings_geojson(p_campaign_id),
          v_buildings
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        v_buildings := COALESCE(
          public.get_campaign_buildings_geojson(p_campaign_id),
          v_buildings
        );
      EXCEPTION WHEN OTHERS THEN
        v_buildings := jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb);
      END;
    END;
  END IF;
  -- For diamond/bedrock_* campaigns, buildings come from PMTiles artifacts
  -- via the frontend fallback (MapBuildingsLayer manifest path). Skipping the
  -- Gold building RPC here prevents statement timeouts on
  -- rpc_get_campaign_full_features for these campaigns.

  BEGIN
    v_parcels := COALESCE(public.rpc_get_campaign_parcels(p_campaign_id), v_parcels);
  EXCEPTION WHEN OTHERS THEN
    v_parcels := jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb);
  END;

  BEGIN
    v_roads := COALESCE(public.rpc_get_campaign_roads_v2(p_campaign_id), v_roads);
  EXCEPTION WHEN OTHERS THEN
    v_roads := jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb);
  END;

  v_address_count := COALESCE(jsonb_array_length(v_addresses->'features'), 0);
  v_building_count := COALESCE(jsonb_array_length(v_buildings->'features'), 0);
  v_parcel_count := COALESCE(jsonb_array_length(v_parcels->'features'), 0);
  v_road_count := COALESCE(jsonb_array_length(v_roads->'features'), 0);

  SELECT GREATEST(
    COALESCE(v_campaign.updated_at, '-infinity'::timestamptz),
    COALESCE(v_campaign.addresses_ready_at, '-infinity'::timestamptz),
    COALESCE(v_campaign.map_ready_at, '-infinity'::timestamptz),
    COALESCE(v_campaign.optimized_at, '-infinity'::timestamptz),
    COALESCE((SELECT max(ca.created_at) FROM public.campaign_addresses ca WHERE ca.campaign_id = p_campaign_id), '-infinity'::timestamptz),
    COALESCE((SELECT max(cp.created_at) FROM public.campaign_parcels cp WHERE cp.campaign_id = p_campaign_id), '-infinity'::timestamptz)
  )
  INTO v_updated_at;

  IF v_updated_at = '-infinity'::timestamptz THEN
    v_updated_at := now();
  END IF;

  RETURN jsonb_build_object(
    'campaign_id', p_campaign_id,
    'status', COALESCE(v_campaign.provision_status::text, 'pending'),
    'phase', COALESCE(v_campaign.provision_phase::text, v_campaign.provision_status::text, 'pending'),
    'source', COALESCE(v_campaign.provision_source::text, 'unknown'),
    'region', v_campaign.region,
    'map_ready', v_address_count > 0 AND (v_building_count > 0 OR v_parcel_count > 0 OR COALESCE(v_campaign.map_ready_at, v_campaign.optimized_at) IS NOT NULL),
    'addresses', v_addresses,
    'buildings', v_buildings,
    'parcels', v_parcels,
    'roads', v_roads,
    'counts', jsonb_build_object(
      'addresses', v_address_count,
      'buildings', v_building_count,
      'parcels', v_parcel_count,
      'roads', v_road_count
    ),
    'updated_at', v_updated_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_campaign_map_bundle(uuid) TO authenticated, anon, service_role;

COMMENT ON FUNCTION public.rpc_get_campaign_map_bundle(uuid) IS
'Unified campaign map bundle for web and iOS. Returns normalized GeoJSON FeatureCollections for addresses, buildings, parcels, and roads regardless of Diamond or Bedrock source.';
