BEGIN;

CREATE TABLE IF NOT EXISTS public.territory_iq_dataset_catalogue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id text NOT NULL UNIQUE,
  dataset_name text NOT NULL,
  official_publisher text NOT NULL,
  official_download_url text NOT NULL,
  official_metadata_url text,
  authority_tier text NOT NULL
    CHECK (authority_tier IN ('federal', 'provincial', 'territorial', 'municipal', 'regional', 'utility', 'third_party')),
  coverage_scope text NOT NULL,
  coverage_name text NOT NULL,
  coverage geography(Geometry, 4326),
  coverage_geometry_kind text,
  geographic_resolution text NOT NULL,
  update_frequency text NOT NULL,
  licence_name text NOT NULL,
  licence_url text,
  commercial_use_status text NOT NULL
    CHECK (commercial_use_status IN ('allowed', 'restricted', 'procurement_required', 'unclear')),
  file_formats text[] NOT NULL DEFAULT '{}',
  estimated_size_bytes bigint,
  estimated_size_label text,
  fields_available text[] NOT NULL DEFAULT '{}',
  download_automation_possible boolean NOT NULL DEFAULT false,
  api_available boolean NOT NULL DEFAULT false,
  api_kind text,
  engineering_effort smallint NOT NULL CHECK (engineering_effort BETWEEN 1 AND 10),
  business_value smallint NOT NULL CHECK (business_value BETWEEN 1 AND 10),
  acquisition_ease smallint NOT NULL CHECK (acquisition_ease BETWEEN 1 AND 10),
  maintenance_ease smallint NOT NULL CHECK (maintenance_ease BETWEEN 1 AND 10),
  competitive_advantage smallint NOT NULL CHECK (competitive_advantage BETWEEN 1 AND 10),
  confidence numeric NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  nationwide_coverage_score smallint NOT NULL CHECK (nationwide_coverage_score BETWEEN 1 AND 10),
  rank_score numeric NOT NULL CHECK (rank_score BETWEEN 0 AND 10),
  recommendation text NOT NULL CHECK (recommendation IN ('required', 'optional', 'nice_to_have')),
  categories text[] NOT NULL DEFAULT '{}',
  grid_score_factors text[] NOT NULL DEFAULT '{}',
  applicable_industries text[] NOT NULL DEFAULT '{}',
  derived_metrics jsonb NOT NULL DEFAULT '[]'::jsonb,
  quality_summary text NOT NULL,
  completeness_summary text NOT NULL,
  legal_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  duplicate_of_dataset_id text,
  predecessor_dataset_ids text[] NOT NULL DEFAULT '{}',
  ingestion_status text NOT NULL DEFAULT 'discovered'
    CHECK (ingestion_status IN ('discovered', 'verified', 'queued', 'downloading', 'staged', 'validated', 'promoted', 'quarantined', 'blocked')),
  raw_s3_prefix text,
  normalized_s3_prefix text,
  derived_s3_prefix text,
  checksum_sha256 text,
  source_release_date date,
  last_verified_at timestamptz NOT NULL,
  refresh_due_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS territory_iq_dataset_catalogue_rank_idx
  ON public.territory_iq_dataset_catalogue(recommendation, rank_score DESC);
CREATE INDEX IF NOT EXISTS territory_iq_dataset_catalogue_categories_idx
  ON public.territory_iq_dataset_catalogue USING gin(categories);
CREATE INDEX IF NOT EXISTS territory_iq_dataset_catalogue_industries_idx
  ON public.territory_iq_dataset_catalogue USING gin(applicable_industries);
CREATE INDEX IF NOT EXISTS territory_iq_dataset_catalogue_coverage_idx
  ON public.territory_iq_dataset_catalogue USING gist(coverage);

CREATE TABLE IF NOT EXISTS public.territory_iq_acquisition_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id text NOT NULL REFERENCES public.territory_iq_dataset_catalogue(dataset_id) ON DELETE CASCADE,
  dataset_version text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  phase text NOT NULL
    CHECK (phase IN ('discover', 'inspect', 'download', 'validate', 'normalize', 'derive', 'publish', 'promote')),
  status text NOT NULL
    CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'quarantined', 'blocked', 'unchanged')),
  attempt_count integer NOT NULL DEFAULT 0,
  lease_owner text,
  lease_expires_at timestamptz,
  etag text,
  last_modified text,
  checksum_sha256 text,
  content_length bigint,
  raw_s3_uri text,
  normalized_s3_uris text[] NOT NULL DEFAULT '{}',
  derived_s3_uris text[] NOT NULL DEFAULT '{}',
  quality_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS territory_iq_acquisition_runs_queue_idx
  ON public.territory_iq_acquisition_runs(status, phase, lease_expires_at, created_at);
CREATE INDEX IF NOT EXISTS territory_iq_acquisition_runs_dataset_idx
  ON public.territory_iq_acquisition_runs(dataset_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.territory_iq_campaign_market_audits (
  campaign_id uuid PRIMARY KEY REFERENCES public.campaigns(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  province_code text,
  csd_dguid text,
  csd_name text,
  regional_government_name text,
  utility_territories jsonb NOT NULL DEFAULT '[]'::jsonb,
  official_portals jsonb NOT NULL DEFAULT '[]'::jsonb,
  audit_status text NOT NULL DEFAULT 'unresolved'
    CHECK (audit_status IN ('unresolved', 'queued', 'in_progress', 'complete', 'blocked')),
  datasets_found integer NOT NULL DEFAULT 0,
  gaps jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolved_at timestamptz,
  audited_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.territory_iq_source_versions
  ADD COLUMN IF NOT EXISTS catalogue_dataset_id text,
  ADD COLUMN IF NOT EXISTS authority_tier text,
  ADD COLUMN IF NOT EXISTS geographic_resolution text,
  ADD COLUMN IF NOT EXISTS refresh_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS licence_status text,
  ADD COLUMN IF NOT EXISTS raw_s3_uri text,
  ADD COLUMN IF NOT EXISTS normalized_s3_uris text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS quality_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS derived_metric_versions jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.territory_iq_census_areas
  ADD COLUMN IF NOT EXISTS csd_dguid text,
  ADD COLUMN IF NOT EXISTS csd_name text,
  ADD COLUMN IF NOT EXISTS cma_ca_uid text,
  ADD COLUMN IF NOT EXISTS cma_ca_name text,
  ADD COLUMN IF NOT EXISTS normalized_measures jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'territory_iq_source_catalogue_fk'
  ) THEN
    ALTER TABLE public.territory_iq_source_versions
      ADD CONSTRAINT territory_iq_source_catalogue_fk
      FOREIGN KEY (catalogue_dataset_id)
      REFERENCES public.territory_iq_dataset_catalogue(dataset_id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

ALTER TABLE public.territory_iq_dataset_catalogue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.territory_iq_acquisition_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.territory_iq_campaign_market_audits ENABLE ROW LEVEL SECURITY;

CREATE POLICY territory_iq_catalogue_service_manage
  ON public.territory_iq_dataset_catalogue FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY territory_iq_acquisition_runs_service_manage
  ON public.territory_iq_acquisition_runs FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY territory_iq_market_audits_service_manage
  ON public.territory_iq_campaign_market_audits FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON public.territory_iq_dataset_catalogue TO service_role;
GRANT ALL ON public.territory_iq_acquisition_runs TO service_role;
GRANT ALL ON public.territory_iq_campaign_market_audits TO service_role;

CREATE OR REPLACE FUNCTION public.claim_territory_iq_acquisition_run(
  p_worker_id text,
  p_lease_seconds integer DEFAULT 300
)
RETURNS SETOF public.territory_iq_acquisition_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid;
BEGIN
  SELECT id INTO v_run_id
  FROM public.territory_iq_acquisition_runs
  WHERE status IN ('queued', 'processing')
    AND (lease_expires_at IS NULL OR lease_expires_at < now())
    AND attempt_count < 5
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_run_id IS NULL THEN RETURN; END IF;

  UPDATE public.territory_iq_acquisition_runs
  SET status = 'processing',
      lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => GREATEST(60, p_lease_seconds)),
      attempt_count = attempt_count + 1,
      started_at = COALESCE(started_at, now()),
      updated_at = now()
  WHERE id = v_run_id;

  RETURN QUERY SELECT * FROM public.territory_iq_acquisition_runs WHERE id = v_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_territory_iq_acquisition_run(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_territory_iq_acquisition_run(text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_territory_iq_campaign_market_audits()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  INSERT INTO public.territory_iq_campaign_market_audits (
    campaign_id,
    workspace_id,
    province_code,
    csd_dguid,
    csd_name,
    audit_status,
    resolved_at,
    updated_at
  )
  SELECT
    c.id,
    c.workspace_id,
    area.province_code,
    area.csd_dguid,
    area.csd_name,
    CASE WHEN area.csd_dguid IS NULL THEN 'unresolved' ELSE 'queued' END,
    CASE WHEN area.csd_dguid IS NULL THEN NULL ELSE now() END,
    now()
  FROM public.campaigns c
  LEFT JOIN LATERAL (
    SELECT a.province_code, a.csd_dguid, a.csd_name
    FROM public.territory_iq_census_areas a
    JOIN public.territory_iq_source_versions sv ON sv.id = a.source_version_id
    WHERE sv.is_promoted = true
      AND ST_Intersects(
        a.geom,
        COALESCE(
          ST_Centroid(c.territory_boundary::geometry)::geography,
          (
            SELECT ST_Centroid(ST_Collect(ca.geom::geometry))::geography
            FROM public.campaign_addresses ca
            WHERE ca.campaign_id = c.id
          )
        )
      )
    ORDER BY a.geography_level = 'DA' DESC
    LIMIT 1
  ) area ON true
  WHERE upper(COALESCE(c.region, '')) IN (
    'AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT'
  )
  ON CONFLICT (campaign_id) DO UPDATE SET
    workspace_id = EXCLUDED.workspace_id,
    province_code = EXCLUDED.province_code,
    csd_dguid = EXCLUDED.csd_dguid,
    csd_name = EXCLUDED.csd_name,
    audit_status = CASE
      WHEN public.territory_iq_campaign_market_audits.csd_dguid IS DISTINCT FROM EXCLUDED.csd_dguid
        THEN EXCLUDED.audit_status
      ELSE public.territory_iq_campaign_market_audits.audit_status
    END,
    resolved_at = EXCLUDED.resolved_at,
    updated_at = now();

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_territory_iq_campaign_market_audits() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_territory_iq_campaign_market_audits() TO service_role;

CREATE OR REPLACE FUNCTION public.search_territory_iq_dataset_coverage(
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision
)
RETURNS SETOF public.territory_iq_dataset_catalogue
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT catalogue.*
  FROM public.territory_iq_dataset_catalogue catalogue
  WHERE catalogue.coverage IS NULL
     OR ST_Intersects(
       catalogue.coverage,
       ST_MakeEnvelope(p_west, p_south, p_east, p_north, 4326)::geography
     )
  ORDER BY catalogue.rank_score DESC, catalogue.dataset_name;
$$;

REVOKE ALL ON FUNCTION public.search_territory_iq_dataset_coverage(
  double precision,
  double precision,
  double precision,
  double precision
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_territory_iq_dataset_coverage(
  double precision,
  double precision,
  double precision,
  double precision
) TO service_role;

COMMIT;
