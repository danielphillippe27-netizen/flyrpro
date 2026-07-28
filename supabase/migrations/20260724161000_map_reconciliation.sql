-- Durable, reversible post-provision map reconciliation.
CREATE TABLE IF NOT EXISTS public.map_reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  source_signature text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  algorithm_version text NOT NULL,
  mode text NOT NULL DEFAULT 'shadow'
    CHECK (mode IN ('off', 'shadow', 'apply_high_confidence')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN (
      'queued', 'matching', 'geocoding', 'applying', 'review_needed',
      'completed', 'failed', 'superseded'
    )),
  phase text NOT NULL DEFAULT 'queued',
  cursor jsonb NOT NULL DEFAULT '{}'::jsonb,
  lease_owner text,
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  before_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  applied_bundle_signature text,
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS map_reconciliation_runs_campaign_idx
  ON public.map_reconciliation_runs(campaign_id, queued_at DESC);
CREATE INDEX IF NOT EXISTS map_reconciliation_runs_queue_idx
  ON public.map_reconciliation_runs(status, lease_expires_at, queued_at);

CREATE TABLE IF NOT EXISTS public.map_reconciliation_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.map_reconciliation_runs(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN (
    'link_address', 'reassign_address', 'create_synthetic_address',
    'adjust_label', 'hide_duplicate', 'hide_auxiliary', 'leave_unresolved'
  )),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN (
    'proposed', 'requires_review', 'applied', 'rejected', 'rolled_back', 'stale'
  )),
  address_id uuid REFERENCES public.campaign_addresses(id) ON DELETE SET NULL,
  building_id text,
  secondary_building_id text,
  unit_id uuid,
  parent_building_id text,
  unit_index integer,
  address_identity text,
  split_signature text,
  evidence_codes text[] NOT NULL DEFAULT '{}'::text[],
  score double precision NOT NULL DEFAULT 0,
  runner_up_margin double precision,
  precondition_hash text NOT NULL,
  before_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  proposed_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  applied_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,
  review_reason text,
  rolled_back_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS map_reconciliation_decisions_run_idx
  ON public.map_reconciliation_decisions(run_id, status, score DESC);
CREATE INDEX IF NOT EXISTS map_reconciliation_decisions_campaign_idx
  ON public.map_reconciliation_decisions(campaign_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.campaign_address_adjustments (
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  address_id uuid NOT NULL REFERENCES public.campaign_addresses(id) ON DELETE CASCADE,
  label_anchor_lon double precision,
  label_anchor_lat double precision,
  access_lon double precision,
  access_lat double precision,
  source text NOT NULL DEFAULT 'reconciliation',
  decision_id uuid REFERENCES public.map_reconciliation_decisions(id) ON DELETE SET NULL,
  algorithm_version text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, address_id)
);

CREATE TABLE IF NOT EXISTS public.campaign_building_resolutions (
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  building_id text NOT NULL,
  resolution_status text NOT NULL DEFAULT 'active'
    CHECK (resolution_status IN ('active', 'hidden_duplicate', 'hidden_auxiliary')),
  canonical_building_id text,
  reason text,
  confidence double precision,
  decision_id uuid REFERENCES public.map_reconciliation_decisions(id) ON DELETE SET NULL,
  algorithm_version text,
  previous_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, building_id)
);

CREATE TABLE IF NOT EXISTS public.reverse_geocode_cache (
  cache_key text PRIMARY KEY,
  provider text NOT NULL,
  provider_version text NOT NULL,
  longitude double precision NOT NULL,
  latitude double precision NOT NULL,
  response jsonb NOT NULL,
  normalized_identity text,
  accuracy text,
  permanent_storage boolean NOT NULL DEFAULT false,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.map_reconciliation_idempotency (
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  decision_id uuid REFERENCES public.map_reconciliation_decisions(id) ON DELETE SET NULL,
  response jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, idempotency_key)
);

ALTER TABLE public.building_address_links
  ADD COLUMN IF NOT EXISTS reconciliation_decision_id uuid
    REFERENCES public.map_reconciliation_decisions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS evidence_codes text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS link_state text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS user_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reconciliation_version text;

ALTER TABLE public.campaign_map_bundles
  ADD COLUMN IF NOT EXISTS reconciliation jsonb NOT NULL DEFAULT '{"status":"not_started"}'::jsonb,
  ADD COLUMN IF NOT EXISTS reconciliation_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS building_units jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.map_reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.map_reconciliation_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_address_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_building_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reverse_geocode_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.map_reconciliation_idempotency ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.claim_map_reconciliation_run(
  p_worker_id text,
  p_lease_seconds integer DEFAULT 120
)
RETURNS SETOF public.map_reconciliation_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid;
BEGIN
  SELECT id
  INTO v_run_id
  FROM public.map_reconciliation_runs
  WHERE status IN ('queued', 'matching', 'geocoding', 'applying')
    AND (lease_expires_at IS NULL OR lease_expires_at < now())
    AND attempt_count < 5
  ORDER BY queued_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_run_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.map_reconciliation_runs
  SET
    lease_owner = p_worker_id,
    lease_expires_at = now() + make_interval(secs => GREATEST(30, p_lease_seconds)),
    attempt_count = attempt_count + 1,
    started_at = COALESCE(started_at, now()),
    status = CASE WHEN status = 'queued' THEN 'matching' ELSE status END,
    phase = CASE WHEN status = 'queued' THEN 'matching' ELSE phase END,
    updated_at = now()
  WHERE id = v_run_id;

  RETURN QUERY
  SELECT *
  FROM public.map_reconciliation_runs
  WHERE id = v_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_map_reconciliation_run(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_map_reconciliation_run(text, integer) TO service_role;

CREATE OR REPLACE VIEW public.map_reconciliation_run_summaries AS
SELECT
  run.id,
  run.campaign_id,
  campaign.name AS campaign_name,
  run.mode,
  run.status,
  run.phase,
  run.algorithm_version,
  run.source_signature,
  run.before_metrics,
  run.after_metrics,
  run.report,
  run.error_message,
  run.queued_at,
  run.started_at,
  run.completed_at,
  COUNT(decision.id) AS decision_count,
  COUNT(decision.id) FILTER (WHERE decision.status = 'applied') AS applied_count,
  COUNT(decision.id) FILTER (WHERE decision.status = 'requires_review') AS review_count,
  COUNT(decision.id) FILTER (WHERE decision.status = 'rolled_back') AS rollback_count,
  COUNT(decision.id) FILTER (WHERE decision.status = 'rejected') AS rejected_count,
  COUNT(decision.id) FILTER (
    WHERE decision.action = 'create_synthetic_address'
  ) AS synthetic_suggestion_count,
  COUNT(decision.id) FILTER (
    WHERE decision.action = 'create_synthetic_address'
      AND decision.status = 'applied'
  ) AS synthetic_applied_count
FROM public.map_reconciliation_runs AS run
JOIN public.campaigns AS campaign ON campaign.id = run.campaign_id
LEFT JOIN public.map_reconciliation_decisions AS decision ON decision.run_id = run.id
GROUP BY run.id, campaign.name;

COMMENT ON TABLE public.map_reconciliation_runs IS
  'Durable post-provision reconciliation jobs; the existing map remains usable for every run state.';
COMMENT ON TABLE public.campaign_address_adjustments IS
  'Visual label/access coordinates only. campaign_addresses.geom remains immutable.';
