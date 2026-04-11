BEGIN;

ALTER TABLE public.route_plans
  ADD COLUMN IF NOT EXISTS route_version integer NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.bump_route_plan_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.route_plans
  SET route_version = COALESCE(route_version, 1) + 1,
      updated_at = now()
  WHERE id = COALESCE(NEW.route_plan_id, OLD.route_plan_id);

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_route_stops_bump_route_plan_version_insert ON public.route_stops;
CREATE TRIGGER trg_route_stops_bump_route_plan_version_insert
  AFTER INSERT ON public.route_stops
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_route_plan_version();

DROP TRIGGER IF EXISTS trg_route_stops_bump_route_plan_version_update ON public.route_stops;
CREATE TRIGGER trg_route_stops_bump_route_plan_version_update
  AFTER UPDATE ON public.route_stops
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_route_plan_version();

DROP TRIGGER IF EXISTS trg_route_stops_bump_route_plan_version_delete ON public.route_stops;
CREATE TRIGGER trg_route_stops_bump_route_plan_version_delete
  AFTER DELETE ON public.route_stops
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_route_plan_version();

CREATE TABLE IF NOT EXISTS public.route_map_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid REFERENCES public.route_assignments(id) ON DELETE CASCADE,
  route_plan_id uuid NOT NULL REFERENCES public.route_plans(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  snapshot_kind text NOT NULL DEFAULT 'assignment' CHECK (snapshot_kind IN ('plan', 'assignment')),
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'stale', 'building', 'failed')),
  campaign_version text NOT NULL,
  route_version integer NOT NULL DEFAULT 1,
  stops_geojson jsonb NOT NULL DEFAULT '{"type":"FeatureCollection","features":[]}'::jsonb,
  buildings_geojson jsonb NOT NULL DEFAULT '{"type":"FeatureCollection","features":[]}'::jsonb,
  addresses_geojson jsonb NOT NULL DEFAULT '{"type":"FeatureCollection","features":[]}'::jsonb,
  roads_geojson jsonb,
  bbox jsonb,
  feature_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_route_map_snapshots_route_plan
  ON public.route_map_snapshots(route_plan_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_route_map_snapshots_campaign
  ON public.route_map_snapshots(campaign_id, generated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_route_map_snapshots_assignment_unique
  ON public.route_map_snapshots(assignment_id)
  WHERE assignment_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_route_map_snapshots_touch_updated_at ON public.route_map_snapshots;
CREATE TRIGGER trg_route_map_snapshots_touch_updated_at
  BEFORE UPDATE ON public.route_map_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.route_touch_updated_at();

ALTER TABLE public.route_map_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "route_map_snapshots_select_policy" ON public.route_map_snapshots;
CREATE POLICY "route_map_snapshots_select_policy"
ON public.route_map_snapshots
FOR SELECT
USING (
  public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner', 'admin'])
  OR EXISTS (
    SELECT 1
    FROM public.route_assignments ra
    WHERE ra.id = route_map_snapshots.assignment_id
      AND ra.assigned_to_user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.route_plans rp
    WHERE rp.id = route_map_snapshots.route_plan_id
      AND rp.created_by_user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "route_map_snapshots_mutation_policy" ON public.route_map_snapshots;
CREATE POLICY "route_map_snapshots_mutation_policy"
ON public.route_map_snapshots
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

COMMIT;
