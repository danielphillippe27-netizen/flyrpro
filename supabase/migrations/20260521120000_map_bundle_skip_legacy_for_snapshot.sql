-- Skip legacy Gold building aggregation when a campaign already has a Diamond/Bedrock
-- snapshot, even if campaigns.provision_source was never persisted (common for iOS-created
-- campaigns that finished provisioning before provision_source was written).

CREATE OR REPLACE FUNCTION public.rpc_get_campaign_map_bundle(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign record;
  v_snapshot_metrics jsonb;
  v_snapshot_buildings_key text;
  v_skip_legacy_buildings boolean := false;
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

  SELECT cs.tile_metrics, cs.buildings_key
  INTO v_snapshot_metrics, v_snapshot_buildings_key
  FROM public.campaign_snapshots cs
  WHERE cs.campaign_id = p_campaign_id;

  v_skip_legacy_buildings :=
    v_campaign.provision_source IN (
      'diamond', 'bedrock_ca', 'bedrock_us', 'bedrock_au',
      'bedrock_nz', 'bedrock_za', 'bedrock_uk'
    )
    OR COALESCE((v_snapshot_metrics ->> 'bedrock_mode')::boolean, false)
    OR COALESCE((v_snapshot_metrics ->> 'diamond_mode')::boolean, false)
    OR COALESCE(v_snapshot_metrics ->> 'pmtiles_key', v_snapshot_buildings_key, '') LIKE '%.pmtiles';

  BEGIN
    v_addresses := COALESCE(public.rpc_get_campaign_addresses(p_campaign_id), v_addresses);
  EXCEPTION WHEN OTHERS THEN
    v_addresses := jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb);
  END;

  IF NOT v_skip_legacy_buildings THEN
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
'Unified campaign map bundle for web and iOS. Skips legacy Gold building RPC when provision_source or campaign_snapshots indicate Diamond/Bedrock PMTiles artifacts.';
