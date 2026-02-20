-- Route plans and team assignments for iOS Routes tab.
-- Persists web street segments as reusable route plans with ordered stops.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.route_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  created_by_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  total_stops integer NOT NULL DEFAULT 0 CHECK (total_stops >= 0),
  est_minutes integer CHECK (est_minutes IS NULL OR est_minutes >= 0),
  distance_meters integer CHECK (distance_meters IS NULL OR distance_meters >= 0),
  segments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_route_plans_workspace_id
  ON public.route_plans(workspace_id);
CREATE INDEX IF NOT EXISTS idx_route_plans_campaign_id
  ON public.route_plans(campaign_id);
CREATE INDEX IF NOT EXISTS idx_route_plans_created_at
  ON public.route_plans(created_at DESC);

CREATE TABLE IF NOT EXISTS public.route_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_plan_id uuid NOT NULL REFERENCES public.route_plans(id) ON DELETE CASCADE,
  stop_order integer NOT NULL CHECK (stop_order > 0),
  address_id uuid REFERENCES public.campaign_addresses(id) ON DELETE SET NULL,
  gers_id text,
  lat double precision,
  lng double precision,
  display_address text,
  building_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_route_stops_route_plan_order
  ON public.route_stops(route_plan_id, stop_order);

CREATE TABLE IF NOT EXISTS public.route_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_plan_id uuid NOT NULL REFERENCES public.route_plans(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  assigned_to_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_by_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'in_progress', 'completed', 'cancelled')),
  started_at timestamptz,
  completed_at timestamptz,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_route_assignments_workspace_id
  ON public.route_assignments(workspace_id);
CREATE INDEX IF NOT EXISTS idx_route_assignments_assignee_status
  ON public.route_assignments(assigned_to_user_id, status);
CREATE INDEX IF NOT EXISTS idx_route_assignments_route_plan_id
  ON public.route_assignments(route_plan_id);

-- ---------------------------------------------------------------------------
-- 2) Helpers and triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.route_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_route_plans_touch_updated_at ON public.route_plans;
CREATE TRIGGER trg_route_plans_touch_updated_at
  BEFORE UPDATE ON public.route_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.route_touch_updated_at();

DROP TRIGGER IF EXISTS trg_route_assignments_touch_updated_at ON public.route_assignments;
CREATE TRIGGER trg_route_assignments_touch_updated_at
  BEFORE UPDATE ON public.route_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.route_touch_updated_at();

CREATE OR REPLACE FUNCTION public.has_workspace_role(
  p_workspace_id uuid,
  p_user_id uuid,
  p_roles text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = p_user_id
      AND wm.role = ANY(p_roles)
  )
$$;

CREATE OR REPLACE FUNCTION public.can_access_route_plan(
  p_route_plan_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.route_plans rp
    WHERE rp.id = p_route_plan_id
      AND (
        public.has_workspace_role(rp.workspace_id, p_user_id, ARRAY['owner', 'admin'])
        OR rp.created_by_user_id = p_user_id
        OR EXISTS (
          SELECT 1
          FROM public.route_assignments ra
          WHERE ra.route_plan_id = rp.id
            AND ra.assigned_to_user_id = p_user_id
        )
      )
  )
$$;

-- Assigned members can only change status/progress/timestamps.
CREATE OR REPLACE FUNCTION public.route_assignment_member_update_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_to_user_id = auth.uid()
     AND NOT public.has_workspace_role(NEW.workspace_id, auth.uid(), ARRAY['owner', 'admin']) THEN
    IF NEW.route_plan_id <> OLD.route_plan_id
       OR NEW.workspace_id <> OLD.workspace_id
       OR NEW.assigned_to_user_id <> OLD.assigned_to_user_id
       OR NEW.assigned_by_user_id <> OLD.assigned_by_user_id
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'assigned users cannot change assignment ownership fields';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_route_assignment_member_update_guard ON public.route_assignments;
CREATE TRIGGER trg_route_assignment_member_update_guard
  BEFORE UPDATE ON public.route_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.route_assignment_member_update_guard();

-- ---------------------------------------------------------------------------
-- 3) RLS policies
-- ---------------------------------------------------------------------------
ALTER TABLE public.route_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "route_plans_select_policy" ON public.route_plans;
CREATE POLICY "route_plans_select_policy"
ON public.route_plans
FOR SELECT
USING (
  public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner', 'admin'])
  OR created_by_user_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.route_assignments ra
    WHERE ra.route_plan_id = route_plans.id
      AND ra.assigned_to_user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "route_plans_insert_policy" ON public.route_plans;
CREATE POLICY "route_plans_insert_policy"
ON public.route_plans
FOR INSERT
WITH CHECK (
  (
    public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner', 'admin'])
  )
  OR (
    public.is_workspace_member(workspace_id)
    AND created_by_user_id = auth.uid()
    AND status = 'draft'
  )
);

DROP POLICY IF EXISTS "route_plans_update_policy" ON public.route_plans;
CREATE POLICY "route_plans_update_policy"
ON public.route_plans
FOR UPDATE
USING (
  public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner', 'admin'])
  OR (created_by_user_id = auth.uid() AND status = 'draft')
)
WITH CHECK (
  public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner', 'admin'])
  OR (created_by_user_id = auth.uid() AND status = 'draft')
);

DROP POLICY IF EXISTS "route_plans_delete_policy" ON public.route_plans;
CREATE POLICY "route_plans_delete_policy"
ON public.route_plans
FOR DELETE
USING (
  public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner', 'admin'])
  OR (created_by_user_id = auth.uid() AND status = 'draft')
);

DROP POLICY IF EXISTS "route_stops_select_policy" ON public.route_stops;
CREATE POLICY "route_stops_select_policy"
ON public.route_stops
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.route_plans rp
    WHERE rp.id = route_stops.route_plan_id
      AND public.can_access_route_plan(rp.id, auth.uid())
  )
);

DROP POLICY IF EXISTS "route_stops_insert_policy" ON public.route_stops;
CREATE POLICY "route_stops_insert_policy"
ON public.route_stops
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.route_plans rp
    WHERE rp.id = route_stops.route_plan_id
      AND public.has_workspace_role(rp.workspace_id, auth.uid(), ARRAY['owner', 'admin'])
  )
);

DROP POLICY IF EXISTS "route_stops_update_policy" ON public.route_stops;
CREATE POLICY "route_stops_update_policy"
ON public.route_stops
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.route_plans rp
    WHERE rp.id = route_stops.route_plan_id
      AND public.has_workspace_role(rp.workspace_id, auth.uid(), ARRAY['owner', 'admin'])
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.route_plans rp
    WHERE rp.id = route_stops.route_plan_id
      AND public.has_workspace_role(rp.workspace_id, auth.uid(), ARRAY['owner', 'admin'])
  )
);

DROP POLICY IF EXISTS "route_stops_delete_policy" ON public.route_stops;
CREATE POLICY "route_stops_delete_policy"
ON public.route_stops
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM public.route_plans rp
    WHERE rp.id = route_stops.route_plan_id
      AND public.has_workspace_role(rp.workspace_id, auth.uid(), ARRAY['owner', 'admin'])
  )
);

DROP POLICY IF EXISTS "route_assignments_select_policy" ON public.route_assignments;
CREATE POLICY "route_assignments_select_policy"
ON public.route_assignments
FOR SELECT
USING (
  public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner', 'admin'])
  OR assigned_to_user_id = auth.uid()
);

DROP POLICY IF EXISTS "route_assignments_insert_policy" ON public.route_assignments;
CREATE POLICY "route_assignments_insert_policy"
ON public.route_assignments
FOR INSERT
WITH CHECK (
  public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner', 'admin'])
);

DROP POLICY IF EXISTS "route_assignments_update_policy" ON public.route_assignments;
CREATE POLICY "route_assignments_update_policy"
ON public.route_assignments
FOR UPDATE
USING (
  public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner', 'admin'])
  OR assigned_to_user_id = auth.uid()
)
WITH CHECK (
  public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner', 'admin'])
  OR assigned_to_user_id = auth.uid()
);

DROP POLICY IF EXISTS "route_assignments_delete_policy" ON public.route_assignments;
CREATE POLICY "route_assignments_delete_policy"
ON public.route_assignments
FOR DELETE
USING (
  public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner', 'admin'])
);

-- ---------------------------------------------------------------------------
-- 4) RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_assigned_routes(p_workspace_id uuid)
RETURNS TABLE (
  assignment_id uuid,
  route_plan_id uuid,
  name text,
  status text,
  total_stops integer,
  est_minutes integer,
  distance_meters integer,
  updated_at timestamptz,
  progress jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ra.id AS assignment_id,
    rp.id AS route_plan_id,
    rp.name,
    ra.status,
    rp.total_stops,
    rp.est_minutes,
    rp.distance_meters,
    ra.updated_at,
    ra.progress
  FROM public.route_assignments ra
  JOIN public.route_plans rp ON rp.id = ra.route_plan_id
  WHERE ra.workspace_id = p_workspace_id
    AND ra.assigned_to_user_id = auth.uid()
    AND public.is_workspace_member(p_workspace_id)
  ORDER BY ra.updated_at DESC
$$;

CREATE OR REPLACE FUNCTION public.get_route_plan_detail(p_route_plan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.route_plans%ROWTYPE;
  v_stops jsonb;
BEGIN
  SELECT rp.*
  INTO v_plan
  FROM public.route_plans rp
  WHERE rp.id = p_route_plan_id;

  IF v_plan.id IS NULL THEN
    RAISE EXCEPTION 'route plan not found';
  END IF;

  IF NOT public.can_access_route_plan(p_route_plan_id, auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', rs.id,
        'route_plan_id', rs.route_plan_id,
        'stop_order', rs.stop_order,
        'address_id', rs.address_id,
        'gers_id', rs.gers_id,
        'lat', rs.lat,
        'lng', rs.lng,
        'display_address', rs.display_address,
        'building_id', rs.building_id,
        'created_at', rs.created_at
      )
      ORDER BY rs.stop_order
    ),
    '[]'::jsonb
  )
  INTO v_stops
  FROM public.route_stops rs
  WHERE rs.route_plan_id = p_route_plan_id;

  RETURN jsonb_build_object(
    'plan', to_jsonb(v_plan),
    'segments', COALESCE(v_plan.segments, '[]'::jsonb),
    'stops', COALESCE(v_stops, '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_route_plan(
  p_route_plan_id uuid,
  p_assigned_to_user_id uuid
)
RETURNS public.route_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.route_plans%ROWTYPE;
  v_assignment public.route_assignments%ROWTYPE;
BEGIN
  SELECT rp.*
  INTO v_plan
  FROM public.route_plans rp
  WHERE rp.id = p_route_plan_id;

  IF v_plan.id IS NULL THEN
    RAISE EXCEPTION 'route plan not found';
  END IF;

  IF NOT public.has_workspace_role(v_plan.workspace_id, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF NOT public.is_workspace_member(v_plan.workspace_id)
     OR NOT public.has_workspace_role(v_plan.workspace_id, p_assigned_to_user_id, ARRAY['owner', 'admin', 'member']) THEN
    RAISE EXCEPTION 'assigned user is not in this workspace';
  END IF;

  INSERT INTO public.route_assignments (
    route_plan_id,
    workspace_id,
    assigned_to_user_id,
    assigned_by_user_id,
    status,
    progress
  )
  VALUES (
    v_plan.id,
    v_plan.workspace_id,
    p_assigned_to_user_id,
    auth.uid(),
    'assigned',
    '{}'::jsonb
  )
  RETURNING *
  INTO v_assignment;

  RETURN v_assignment;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_route_assignment_status(
  p_assignment_id uuid,
  p_status text,
  p_progress jsonb DEFAULT '{}'::jsonb
)
RETURNS public.route_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment public.route_assignments%ROWTYPE;
BEGIN
  IF p_status NOT IN ('assigned', 'in_progress', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;

  SELECT ra.*
  INTO v_assignment
  FROM public.route_assignments ra
  WHERE ra.id = p_assignment_id;

  IF v_assignment.id IS NULL THEN
    RAISE EXCEPTION 'assignment not found';
  END IF;

  IF v_assignment.assigned_to_user_id <> auth.uid()
     AND NOT public.has_workspace_role(v_assignment.workspace_id, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.route_assignments ra
  SET
    status = p_status,
    progress = COALESCE(p_progress, '{}'::jsonb),
    started_at = CASE
      WHEN p_status = 'in_progress' AND ra.started_at IS NULL THEN now()
      ELSE ra.started_at
    END,
    completed_at = CASE
      WHEN p_status = 'completed' THEN now()
      WHEN p_status <> 'completed' THEN NULL
      ELSE ra.completed_at
    END,
    updated_at = now()
  WHERE ra.id = p_assignment_id
  RETURNING *
  INTO v_assignment;

  RETURN v_assignment;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_assigned_routes(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_route_plan_detail(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_route_plan(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_route_assignment_status(uuid, text, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_my_assigned_routes(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_route_plan_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_route_plan(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_route_assignment_status(uuid, text, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) Realtime for assignments/progress updates
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.route_assignments') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_rel pr
       JOIN pg_class c ON c.oid = pr.prrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_publication p ON p.oid = pr.prpubid
       WHERE p.pubname = 'supabase_realtime'
         AND n.nspname = 'public'
         AND c.relname = 'route_assignments'
     ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.route_assignments';
  END IF;
END
$$;

COMMIT;
