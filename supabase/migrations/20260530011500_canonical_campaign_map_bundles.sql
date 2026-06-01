BEGIN;

CREATE TABLE IF NOT EXISTS public.campaign_map_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  asset_signature TEXT NOT NULL,
  source_version TEXT NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  buildings_geojson JSONB NOT NULL DEFAULT jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb),
  addresses_geojson JSONB NOT NULL DEFAULT jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb),
  parcels_geojson JSONB NOT NULL DEFAULT jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb),
  roads_geojson JSONB NOT NULL DEFAULT jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb),
  links JSONB NOT NULL DEFAULT '[]'::jsonb,
  address_orphans JSONB NOT NULL DEFAULT '[]'::jsonb,
  building_orphans JSONB NOT NULL DEFAULT '[]'::jsonb,
  display_mode_hint TEXT NOT NULL DEFAULT 'buildings'
    CHECK (display_mode_hint IN ('buildings', 'addresses')),
  counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  layer_fetched_at JSONB NOT NULL DEFAULT '{}'::jsonb,
  links_status TEXT NOT NULL DEFAULT 'fresh'
    CHECK (links_status IN ('ok', 'fresh', 'ready', 'stale_reused', 'pending_provision', 'client_fallback_required', 'linking_failed')),
  built_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, asset_signature)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_map_bundles_current
  ON public.campaign_map_bundles (campaign_id)
  WHERE is_current = TRUE;

CREATE INDEX IF NOT EXISTS idx_campaign_map_bundles_expires_at
  ON public.campaign_map_bundles (expires_at);

ALTER TABLE public.campaign_map_bundles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaign_map_bundles_select_owner_or_member"
  ON public.campaign_map_bundles;
CREATE POLICY "campaign_map_bundles_select_owner_or_member"
  ON public.campaign_map_bundles
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.campaigns c
      LEFT JOIN public.workspace_members wm
        ON wm.workspace_id = c.workspace_id
       AND wm.user_id = auth.uid()
      LEFT JOIN public.workspaces w
        ON w.id = c.workspace_id
      WHERE c.id = campaign_map_bundles.campaign_id
        AND (
          c.owner_id = auth.uid()
          OR wm.user_id IS NOT NULL
          OR w.owner_id = auth.uid()
        )
    )
  );

DROP POLICY IF EXISTS "campaign_map_bundles_service_manage"
  ON public.campaign_map_bundles;
CREATE POLICY "campaign_map_bundles_service_manage"
  ON public.campaign_map_bundles
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT SELECT ON public.campaign_map_bundles TO authenticated;
GRANT ALL ON public.campaign_map_bundles TO service_role;

CREATE OR REPLACE FUNCTION public.touch_campaign_map_bundles_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_campaign_map_bundles_updated_at
  ON public.campaign_map_bundles;
CREATE TRIGGER touch_campaign_map_bundles_updated_at
  BEFORE UPDATE ON public.campaign_map_bundles
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_campaign_map_bundles_updated_at();

CREATE OR REPLACE FUNCTION public.rpc_get_campaign_map_source_version(p_campaign_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign RECORD;
  v_address_count INTEGER := 0;
  v_building_count INTEGER := 0;
  v_snapshot_building_count INTEGER := 0;
  v_parcel_count INTEGER := 0;
  v_link_count INTEGER := 0;
  v_address_updated_at TIMESTAMPTZ;
  v_building_updated_at TIMESTAMPTZ;
  v_snapshot_updated_at TIMESTAMPTZ;
  v_parcel_updated_at TIMESTAMPTZ;
  v_link_updated_at TIMESTAMPTZ;
  v_payload JSONB;
BEGIN
  SELECT
    c.id,
    c.updated_at,
    c.addresses_ready_at,
    c.map_ready_at,
    c.optimized_at,
    c.territory_boundary,
    c.provision_source,
    c.provision_phase,
    c.map_mode,
    c.has_parcels,
    c.building_link_confidence
  INTO v_campaign
  FROM public.campaigns c
  WHERE c.id = p_campaign_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'source_version', md5(('missing:' || p_campaign_id::TEXT)::TEXT),
      'link_source_version', md5(('missing:' || p_campaign_id::TEXT)::TEXT),
      'counts', jsonb_build_object('addresses', 0, 'buildings', 0, 'parcels', 0, 'links', 0),
      'updated_at', NOW()
    );
  END IF;

  SELECT COUNT(*), MAX(ca.created_at)
  INTO v_address_count, v_address_updated_at
  FROM public.campaign_addresses ca
  WHERE ca.campaign_id = p_campaign_id;

  SELECT COUNT(*), MAX(COALESCE(b.updated_at, b.created_at))
  INTO v_building_count, v_building_updated_at
  FROM public.buildings b
  WHERE b.campaign_id = p_campaign_id;

  IF to_regclass('public.campaign_snapshots') IS NOT NULL THEN
    SELECT
      COALESCE(MAX(
        GREATEST(
          COALESCE(cs.buildings_count, 0),
          CASE
            WHEN COALESCE(cs.tile_metrics->>'campaign_buildings_count', '') ~ '^[0-9]+$'
              THEN (cs.tile_metrics->>'campaign_buildings_count')::INTEGER
            ELSE 0
          END
        )
      ), 0),
      MAX(cs.created_at)
    INTO v_snapshot_building_count, v_snapshot_updated_at
    FROM public.campaign_snapshots cs
    WHERE cs.campaign_id = p_campaign_id;
  END IF;

  IF to_regclass('public.campaign_parcels') IS NOT NULL THEN
    SELECT COUNT(*), MAX(cp.created_at)
    INTO v_parcel_count, v_parcel_updated_at
    FROM public.campaign_parcels cp
    WHERE cp.campaign_id = p_campaign_id;
  END IF;

  SELECT COUNT(*), MAX(COALESCE(bal.modified_at, bal.matched_at))
  INTO v_link_count, v_link_updated_at
  FROM public.building_address_links bal
  WHERE bal.campaign_id = p_campaign_id;

  v_payload := jsonb_build_object(
    'campaign_id', p_campaign_id,
    'campaign_updated_at', v_campaign.updated_at,
    'addresses_ready_at', v_campaign.addresses_ready_at,
    'map_ready_at', v_campaign.map_ready_at,
    'optimized_at', v_campaign.optimized_at,
    'territory_boundary', v_campaign.territory_boundary,
    'provision_source', v_campaign.provision_source,
    'provision_phase', v_campaign.provision_phase,
    'map_mode', v_campaign.map_mode,
    'has_parcels', v_campaign.has_parcels,
    'building_link_confidence', v_campaign.building_link_confidence,
    'address_count', COALESCE(v_address_count, 0),
    'building_count', GREATEST(COALESCE(v_building_count, 0), COALESCE(v_snapshot_building_count, 0)),
    'parcel_count', COALESCE(v_parcel_count, 0),
    'link_count', COALESCE(v_link_count, 0),
    'address_updated_at', v_address_updated_at,
    'building_updated_at', GREATEST(
      COALESCE(v_building_updated_at, '-infinity'::timestamptz),
      COALESCE(v_snapshot_updated_at, '-infinity'::timestamptz)
    ),
    'snapshot_building_count', COALESCE(v_snapshot_building_count, 0),
    'snapshot_updated_at', v_snapshot_updated_at,
    'parcel_updated_at', v_parcel_updated_at,
    'link_updated_at', v_link_updated_at
  );

  RETURN jsonb_build_object(
    'source_version', md5(v_payload::TEXT),
    'link_source_version', md5(v_payload::TEXT),
    'source', v_payload,
    'counts', jsonb_build_object(
      'addresses', COALESCE(v_address_count, 0),
      'buildings', GREATEST(COALESCE(v_building_count, 0), COALESCE(v_snapshot_building_count, 0)),
      'parcels', COALESCE(v_parcel_count, 0),
      'links', COALESCE(v_link_count, 0)
    ),
    'updated_at', GREATEST(
      COALESCE(v_campaign.updated_at, '-infinity'::timestamptz),
      COALESCE(v_campaign.addresses_ready_at, '-infinity'::timestamptz),
      COALESCE(v_campaign.map_ready_at, '-infinity'::timestamptz),
      COALESCE(v_campaign.optimized_at, '-infinity'::timestamptz),
      COALESCE(v_address_updated_at, '-infinity'::timestamptz),
      COALESCE(v_building_updated_at, '-infinity'::timestamptz),
      COALESCE(v_snapshot_updated_at, '-infinity'::timestamptz),
      COALESCE(v_parcel_updated_at, '-infinity'::timestamptz),
      COALESCE(v_link_updated_at, '-infinity'::timestamptz)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_upsert_campaign_map_bundle(
  p_campaign_id UUID,
  p_asset_signature TEXT,
  p_source_version TEXT,
  p_buildings_geojson JSONB,
  p_addresses_geojson JSONB,
  p_parcels_geojson JSONB,
  p_roads_geojson JSONB,
  p_links JSONB,
  p_address_orphans JSONB,
  p_building_orphans JSONB,
  p_display_mode_hint TEXT,
  p_counts JSONB,
  p_layer_fetched_at JSONB,
  p_links_status TEXT,
  p_built_at TIMESTAMPTZ,
  p_expires_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.campaign_map_bundles%ROWTYPE;
BEGIN
  UPDATE public.campaign_map_bundles
  SET is_current = FALSE
  WHERE campaign_id = p_campaign_id
    AND is_current = TRUE
    AND asset_signature <> p_asset_signature;

  INSERT INTO public.campaign_map_bundles (
    campaign_id,
    asset_signature,
    source_version,
    is_current,
    buildings_geojson,
    addresses_geojson,
    parcels_geojson,
    roads_geojson,
    links,
    address_orphans,
    building_orphans,
    display_mode_hint,
    counts,
    layer_fetched_at,
    links_status,
    built_at,
    expires_at
  )
  VALUES (
    p_campaign_id,
    p_asset_signature,
    p_source_version,
    TRUE,
    COALESCE(p_buildings_geojson, jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb)),
    COALESCE(p_addresses_geojson, jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb)),
    COALESCE(p_parcels_geojson, jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb)),
    COALESCE(p_roads_geojson, jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb)),
    COALESCE(p_links, '[]'::jsonb),
    COALESCE(p_address_orphans, '[]'::jsonb),
    COALESCE(p_building_orphans, '[]'::jsonb),
    CASE WHEN p_display_mode_hint = 'addresses' THEN 'addresses' ELSE 'buildings' END,
    COALESCE(p_counts, '{}'::jsonb),
    COALESCE(p_layer_fetched_at, '{}'::jsonb),
    CASE
      WHEN p_links_status IN ('ok', 'ready', 'fresh', 'stale_reused', 'pending_provision', 'client_fallback_required', 'linking_failed') THEN p_links_status
      ELSE 'fresh'
    END,
    COALESCE(p_built_at, NOW()),
    COALESCE(p_expires_at, NOW())
  )
  ON CONFLICT (campaign_id, asset_signature)
  DO UPDATE SET
    source_version = EXCLUDED.source_version,
    is_current = TRUE,
    buildings_geojson = EXCLUDED.buildings_geojson,
    addresses_geojson = EXCLUDED.addresses_geojson,
    parcels_geojson = EXCLUDED.parcels_geojson,
    roads_geojson = EXCLUDED.roads_geojson,
    links = EXCLUDED.links,
    address_orphans = EXCLUDED.address_orphans,
    building_orphans = EXCLUDED.building_orphans,
    display_mode_hint = EXCLUDED.display_mode_hint,
    counts = EXCLUDED.counts,
    layer_fetched_at = EXCLUDED.layer_fetched_at,
    links_status = EXCLUDED.links_status,
    built_at = EXCLUDED.built_at,
    expires_at = EXCLUDED.expires_at
  RETURNING *
  INTO v_row;

  RETURN jsonb_build_object(
    'campaign_id', v_row.campaign_id,
    'asset_signature', v_row.asset_signature,
    'source_version', v_row.source_version,
    'is_current', v_row.is_current,
    'buildings', v_row.buildings_geojson,
    'addresses', v_row.addresses_geojson,
    'parcels', v_row.parcels_geojson,
    'roads', v_row.roads_geojson,
    'links', v_row.links,
    'address_orphans', v_row.address_orphans,
    'building_orphans', v_row.building_orphans,
    'display_mode_hint', v_row.display_mode_hint,
    'counts', v_row.counts,
    'layer_fetched_at', v_row.layer_fetched_at,
    'links_status', v_row.links_status,
    'built_at', v_row.built_at,
    'expires_at', v_row.expires_at,
    'updated_at', v_row.updated_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_campaign_map_source_version(UUID)
TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_upsert_campaign_map_bundle(
  UUID, TEXT, TEXT, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, TEXT, JSONB, JSONB, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
)
TO service_role;

COMMENT ON TABLE public.campaign_map_bundles IS
'Canonical per-campaign hydrated map bundle keyed by source asset signature. Clients use it to avoid repeated geometry and linking work.';

COMMENT ON FUNCTION public.rpc_get_campaign_map_source_version(UUID) IS
'Computes a lightweight campaign map source version from campaign metadata, source counts, and latest timestamps.';

COMMENT ON FUNCTION public.rpc_upsert_campaign_map_bundle(UUID, TEXT, TEXT, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, TEXT, JSONB, JSONB, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) IS
'Atomically marks the prior bundle stale and upserts the current canonical campaign map bundle.';

NOTIFY pgrst, 'reload schema';

COMMIT;
