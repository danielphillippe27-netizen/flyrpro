BEGIN;

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS territory_iq_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.workspaces.territory_iq_enabled IS
  'Workspace rollout flag for the web Territory IQ experience.';

CREATE TABLE IF NOT EXISTS public.territory_iq_source_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL,
  dataset_name text NOT NULL,
  dataset_version text NOT NULL,
  provider text NOT NULL,
  licence_name text NOT NULL,
  licence_url text,
  release_date date,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  checksum_sha256 text NOT NULL,
  coverage geography(MultiPolygon, 4326),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_promoted boolean NOT NULL DEFAULT false,
  promoted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_key, dataset_version)
);

CREATE UNIQUE INDEX IF NOT EXISTS territory_iq_one_promoted_source_version
  ON public.territory_iq_source_versions(source_key)
  WHERE is_promoted;

CREATE INDEX IF NOT EXISTS territory_iq_source_versions_coverage_idx
  ON public.territory_iq_source_versions USING gist(coverage);

CREATE TABLE IF NOT EXISTS public.territory_iq_census_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_version_id uuid NOT NULL
    REFERENCES public.territory_iq_source_versions(id) ON DELETE RESTRICT,
  dguid text NOT NULL,
  geography_level text NOT NULL DEFAULT 'DA',
  name text,
  province_code text NOT NULL,
  market_key text,
  geom geography(MultiPolygon, 4326) NOT NULL,
  occupied_private_dwellings integer,
  median_household_income numeric,
  owner_occupied_pct numeric,
  detached_fit_pct numeric,
  construction_periods jsonb NOT NULL DEFAULT '{}'::jsonb,
  income_percentile numeric,
  owner_percentile numeric,
  detached_percentile numeric,
  data_quality jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_version_id, dguid)
);

CREATE INDEX IF NOT EXISTS territory_iq_census_areas_geom_idx
  ON public.territory_iq_census_areas USING gist(geom);
CREATE INDEX IF NOT EXISTS territory_iq_census_areas_market_idx
  ON public.territory_iq_census_areas(market_key, province_code);

CREATE TABLE IF NOT EXISTS public.territory_iq_permits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_version_id uuid NOT NULL
    REFERENCES public.territory_iq_source_versions(id) ON DELETE RESTRICT,
  source_record_id text NOT NULL,
  municipality text NOT NULL,
  permit_category text NOT NULL,
  service_category text,
  description text,
  status text,
  issued_at date,
  completed_at date,
  geom geography(Point, 4326) NOT NULL,
  confidence numeric NOT NULL DEFAULT 1
    CHECK (confidence >= 0 AND confidence <= 1),
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_version_id, source_record_id)
);

CREATE INDEX IF NOT EXISTS territory_iq_permits_geom_idx
  ON public.territory_iq_permits USING gist(geom);

CREATE TABLE IF NOT EXISTS public.territory_iq_weather_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_version_id uuid NOT NULL
    REFERENCES public.territory_iq_source_versions(id) ON DELETE RESTRICT,
  source_record_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('hail', 'wind')),
  occurred_at timestamptz NOT NULL,
  severity numeric NOT NULL CHECK (severity >= 0 AND severity <= 1),
  confidence numeric NOT NULL DEFAULT 1
    CHECK (confidence >= 0 AND confidence <= 1),
  geom geography(Geometry, 4326) NOT NULL,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_version_id, source_record_id)
);

CREATE INDEX IF NOT EXISTS territory_iq_weather_events_geom_idx
  ON public.territory_iq_weather_events USING gist(geom);

CREATE TABLE IF NOT EXISTS public.territory_iq_score_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL UNIQUE,
  input_hash text NOT NULL,
  model_key text NOT NULL,
  model_version text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'superseded')),
  lease_owner text,
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  requested_by uuid,
  error_message text,
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS territory_iq_score_runs_queue_idx
  ON public.territory_iq_score_runs(status, lease_expires_at, queued_at);
CREATE INDEX IF NOT EXISTS territory_iq_score_runs_campaign_idx
  ON public.territory_iq_score_runs(campaign_id, queued_at DESC);

CREATE TABLE IF NOT EXISTS public.campaign_territory_iq_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.territory_iq_score_runs(id) ON DELETE SET NULL,
  status text NOT NULL
    CHECK (status IN ('ready', 'partial', 'insufficient_data', 'failed')),
  score integer CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  confidence numeric NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  confidence_label text NOT NULL
    CHECK (confidence_label IN ('high', 'medium', 'low', 'very_low')),
  target_home_count integer NOT NULL DEFAULT 0,
  model_key text NOT NULL,
  model_name text NOT NULL,
  model_version text NOT NULL,
  benchmark text NOT NULL,
  explanation text NOT NULL,
  factors jsonb NOT NULL DEFAULT '[]'::jsonb,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_factors text[] NOT NULL DEFAULT '{}',
  input_hash text NOT NULL,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, model_version, input_hash)
);

CREATE INDEX IF NOT EXISTS campaign_territory_iq_scores_current_idx
  ON public.campaign_territory_iq_scores(campaign_id, calculated_at DESC);

CREATE TABLE IF NOT EXISTS public.campaign_territory_iq_cells (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  score_id uuid NOT NULL
    REFERENCES public.campaign_territory_iq_scores(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  cell_key text NOT NULL,
  geom geography(Geometry, 4326) NOT NULL,
  target_home_count integer NOT NULL CHECK (target_home_count > 0),
  target_address_ids uuid[] NOT NULL DEFAULT '{}',
  score integer CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  confidence numeric NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  confidence_label text NOT NULL
    CHECK (confidence_label IN ('high', 'medium', 'low', 'very_low')),
  rank integer,
  factors jsonb NOT NULL DEFAULT '[]'::jsonb,
  census_dguid text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (score_id, cell_key)
);

CREATE INDEX IF NOT EXISTS campaign_territory_iq_cells_geom_idx
  ON public.campaign_territory_iq_cells USING gist(geom);
CREATE INDEX IF NOT EXISTS campaign_territory_iq_cells_campaign_idx
  ON public.campaign_territory_iq_cells(campaign_id, score_id, rank);
CREATE INDEX IF NOT EXISTS campaign_territory_iq_cells_address_ids_idx
  ON public.campaign_territory_iq_cells USING gin(target_address_ids);

ALTER TABLE public.territory_iq_source_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.territory_iq_census_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.territory_iq_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.territory_iq_weather_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.territory_iq_score_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_territory_iq_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_territory_iq_cells ENABLE ROW LEVEL SECURITY;

CREATE POLICY territory_iq_sources_service_manage
  ON public.territory_iq_source_versions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY territory_iq_census_service_manage
  ON public.territory_iq_census_areas FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY territory_iq_permits_service_manage
  ON public.territory_iq_permits FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY territory_iq_weather_service_manage
  ON public.territory_iq_weather_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY territory_iq_runs_service_manage
  ON public.territory_iq_score_runs FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY territory_iq_scores_campaign_read
  ON public.campaign_territory_iq_scores FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.campaigns c
      JOIN public.workspaces w ON w.id = c.workspace_id
      LEFT JOIN public.workspace_members wm
        ON wm.workspace_id = c.workspace_id
       AND wm.user_id = auth.uid()
      WHERE c.id = campaign_id
        AND (
          w.owner_id = auth.uid()
          OR wm.role IN ('owner', 'admin')
        )
    )
  );
CREATE POLICY territory_iq_scores_service_manage
  ON public.campaign_territory_iq_scores FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY territory_iq_cells_campaign_read
  ON public.campaign_territory_iq_cells FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.campaigns c
      JOIN public.workspaces w ON w.id = c.workspace_id
      LEFT JOIN public.workspace_members wm
        ON wm.workspace_id = c.workspace_id
       AND wm.user_id = auth.uid()
      WHERE c.id = campaign_id
        AND (
          w.owner_id = auth.uid()
          OR wm.role IN ('owner', 'admin')
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.campaign_assignments assignment
      WHERE assignment.campaign_id = campaign_id
        AND assignment.assigned_to_user_id = auth.uid()
        AND assignment.status IN ('assigned', 'accepted', 'in_progress')
        AND (
          assignment.mode = 'whole_team'
          OR EXISTS (
            SELECT 1
            FROM public.campaign_assignment_homes home
            WHERE home.assignment_id = assignment.id
              AND home.campaign_address_id = ANY(target_address_ids)
          )
        )
    )
  );
CREATE POLICY territory_iq_cells_service_manage
  ON public.campaign_territory_iq_cells FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT SELECT ON public.campaign_territory_iq_scores TO authenticated;
GRANT SELECT ON public.campaign_territory_iq_cells TO authenticated;
GRANT ALL ON public.territory_iq_source_versions TO service_role;
GRANT ALL ON public.territory_iq_census_areas TO service_role;
GRANT ALL ON public.territory_iq_permits TO service_role;
GRANT ALL ON public.territory_iq_weather_events TO service_role;
GRANT ALL ON public.territory_iq_score_runs TO service_role;
GRANT ALL ON public.campaign_territory_iq_scores TO service_role;
GRANT ALL ON public.campaign_territory_iq_cells TO service_role;

CREATE OR REPLACE FUNCTION public.get_territory_iq_census_areas_for_campaign(
  p_campaign_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH campaign_shape AS (
    SELECT COALESCE(
      territory_boundary::geometry,
      ST_ConvexHull(ST_Collect(ca.geom))
    ) AS geom
    FROM public.campaigns c
    LEFT JOIN public.campaign_addresses ca ON ca.campaign_id = c.id
    WHERE c.id = p_campaign_id
    GROUP BY c.id, c.territory_boundary
  ),
  features AS (
    SELECT jsonb_build_object(
      'type', 'Feature',
      'geometry', ST_AsGeoJSON(a.geom::geometry)::jsonb,
      'properties', jsonb_build_object(
        'dguid', a.dguid,
        'name', a.name,
        'province_code', a.province_code,
        'market_key', a.market_key,
        'occupied_private_dwellings', a.occupied_private_dwellings,
        'median_household_income', a.median_household_income,
        'owner_occupied_pct', a.owner_occupied_pct,
        'detached_fit_pct', a.detached_fit_pct,
        'construction_periods', a.construction_periods,
        'income_percentile', a.income_percentile,
        'owner_percentile', a.owner_percentile,
        'detached_percentile', a.detached_percentile,
        'source_version', sv.dataset_version,
        'source_release_date', sv.release_date,
        'source_provider', sv.provider
      )
    ) AS feature
    FROM public.territory_iq_census_areas a
    JOIN public.territory_iq_source_versions sv
      ON sv.id = a.source_version_id AND sv.is_promoted
    CROSS JOIN campaign_shape c
    WHERE c.geom IS NOT NULL
      AND ST_Intersects(a.geom::geometry, c.geom)
  )
  SELECT jsonb_build_object(
    'type', 'FeatureCollection',
    'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
  )
  FROM features;
$$;

REVOKE ALL ON FUNCTION public.get_territory_iq_census_areas_for_campaign(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_territory_iq_census_areas_for_campaign(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_territory_iq_enrichments_for_campaign(
  p_campaign_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH campaign_shape AS (
    SELECT territory_boundary::geometry AS geom
    FROM public.campaigns
    WHERE id = p_campaign_id
  ),
  permits AS (
    SELECT jsonb_agg(jsonb_build_object(
      'id', p.id,
      'permit_category', p.permit_category,
      'service_category', p.service_category,
      'status', p.status,
      'issued_at', p.issued_at,
      'completed_at', p.completed_at,
      'confidence', p.confidence,
      'longitude', ST_X(p.geom::geometry),
      'latitude', ST_Y(p.geom::geometry)
    )) AS rows
    FROM public.territory_iq_permits p
    JOIN public.territory_iq_source_versions sv
      ON sv.id = p.source_version_id AND sv.is_promoted
    CROSS JOIN campaign_shape c
    WHERE c.geom IS NOT NULL AND ST_Intersects(p.geom::geometry, c.geom)
  ),
  weather AS (
    SELECT jsonb_agg(jsonb_build_object(
      'id', w.id,
      'event_type', w.event_type,
      'occurred_at', w.occurred_at,
      'severity', w.severity,
      'confidence', w.confidence,
      'geometry', ST_AsGeoJSON(w.geom::geometry)::jsonb
    )) AS rows
    FROM public.territory_iq_weather_events w
    JOIN public.territory_iq_source_versions sv
      ON sv.id = w.source_version_id AND sv.is_promoted
    CROSS JOIN campaign_shape c
    WHERE c.geom IS NOT NULL AND ST_Intersects(w.geom::geometry, c.geom)
  )
  SELECT jsonb_build_object(
    'permits', COALESCE(permits.rows, '[]'::jsonb),
    'weather', COALESCE(weather.rows, '[]'::jsonb)
  )
  FROM permits CROSS JOIN weather;
$$;

REVOKE ALL ON FUNCTION public.get_territory_iq_enrichments_for_campaign(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_territory_iq_enrichments_for_campaign(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_territory_iq_score_run(
  p_worker_id text,
  p_lease_seconds integer DEFAULT 120
)
RETURNS SETOF public.territory_iq_score_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid;
BEGIN
  SELECT id INTO v_run_id
  FROM public.territory_iq_score_runs
  WHERE status IN ('queued', 'processing')
    AND (lease_expires_at IS NULL OR lease_expires_at < now())
    AND attempt_count < 5
  ORDER BY queued_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_run_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.territory_iq_score_runs
  SET status = 'processing',
      lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => GREATEST(30, p_lease_seconds)),
      attempt_count = attempt_count + 1,
      started_at = COALESCE(started_at, now()),
      updated_at = now()
  WHERE id = v_run_id;

  RETURN QUERY SELECT * FROM public.territory_iq_score_runs WHERE id = v_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_territory_iq_score_run(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_territory_iq_score_run(text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_campaign_territory_iq(
  p_campaign_id uuid,
  p_reason text DEFAULT 'campaign_change'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.territory_iq_score_runs (
    campaign_id,
    workspace_id,
    idempotency_key,
    input_hash,
    model_key,
    model_version,
    status
  )
  SELECT
    c.id,
    c.workspace_id,
    concat('auto:', p_reason, ':', c.id, ':', txid_current()),
    md5(concat_ws(':', p_reason, c.id::text, txid_current()::text)),
    'auto',
    'grid-score-v1',
    'queued'
  FROM public.campaigns c
  JOIN public.workspaces w ON w.id = c.workspace_id
  WHERE c.id = p_campaign_id
    AND w.territory_iq_enabled = true
  ON CONFLICT (idempotency_key) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_campaign_territory_iq(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_campaign_territory_iq(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.territory_iq_campaign_mutation_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.enqueue_campaign_territory_iq(
    COALESCE(NEW.campaign_id, OLD.campaign_id),
    TG_TABLE_NAME
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS campaign_addresses_enqueue_territory_iq ON public.campaign_addresses;
CREATE TRIGGER campaign_addresses_enqueue_territory_iq
AFTER INSERT OR UPDATE OR DELETE ON public.campaign_addresses
FOR EACH ROW EXECUTE FUNCTION public.territory_iq_campaign_mutation_trigger();

DROP TRIGGER IF EXISTS campaign_map_bundles_enqueue_territory_iq ON public.campaign_map_bundles;
CREATE TRIGGER campaign_map_bundles_enqueue_territory_iq
AFTER INSERT OR UPDATE OF is_current, asset_signature ON public.campaign_map_bundles
FOR EACH ROW EXECUTE FUNCTION public.territory_iq_campaign_mutation_trigger();

CREATE OR REPLACE FUNCTION public.territory_iq_campaign_boundary_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.enqueue_campaign_territory_iq(NEW.id, 'campaign_boundary');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS campaigns_enqueue_territory_iq ON public.campaigns;
CREATE TRIGGER campaigns_enqueue_territory_iq
AFTER UPDATE OF territory_boundary ON public.campaigns
FOR EACH ROW
WHEN (OLD.territory_boundary IS DISTINCT FROM NEW.territory_boundary)
EXECUTE FUNCTION public.territory_iq_campaign_boundary_trigger();

CREATE OR REPLACE FUNCTION public.territory_iq_workspace_profile_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  campaign_row record;
BEGIN
  IF NEW.territory_iq_enabled = true AND (
    OLD.territory_iq_enabled IS DISTINCT FROM NEW.territory_iq_enabled
    OR OLD.industry IS DISTINCT FROM NEW.industry
  ) THEN
    FOR campaign_row IN SELECT id FROM public.campaigns WHERE workspace_id = NEW.id LOOP
      PERFORM public.enqueue_campaign_territory_iq(campaign_row.id, 'workspace_profile');
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workspaces_enqueue_territory_iq ON public.workspaces;
CREATE TRIGGER workspaces_enqueue_territory_iq
AFTER UPDATE OF industry, territory_iq_enabled ON public.workspaces
FOR EACH ROW EXECUTE FUNCTION public.territory_iq_workspace_profile_trigger();

CREATE OR REPLACE FUNCTION public.territory_iq_source_promotion_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  campaign_row record;
BEGIN
  IF NEW.is_promoted = true AND OLD.is_promoted IS DISTINCT FROM NEW.is_promoted THEN
    FOR campaign_row IN
      SELECT c.id
      FROM public.campaigns c
      JOIN public.workspaces w ON w.id = c.workspace_id
      WHERE w.territory_iq_enabled = true
    LOOP
      PERFORM public.enqueue_campaign_territory_iq(campaign_row.id, concat('source:', NEW.id));
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS source_versions_enqueue_territory_iq ON public.territory_iq_source_versions;
CREATE TRIGGER source_versions_enqueue_territory_iq
AFTER UPDATE OF is_promoted ON public.territory_iq_source_versions
FOR EACH ROW EXECUTE FUNCTION public.territory_iq_source_promotion_trigger();

COMMIT;
