BEGIN;

CREATE TABLE IF NOT EXISTS public.campaign_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  assigned_to_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('zone_split', 'whole_team')),
  goal_homes integer NOT NULL DEFAULT 0 CHECK (goal_homes >= 0),
  zone_index integer CHECK (zone_index IS NULL OR zone_index > 0),
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'in_progress', 'completed', 'cancelled')),
  due_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_assignments_campaign_status
  ON public.campaign_assignments(campaign_id, status);

CREATE INDEX IF NOT EXISTS idx_campaign_assignments_assignee_status
  ON public.campaign_assignments(assigned_to_user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaign_assignments_workspace_status
  ON public.campaign_assignments(workspace_id, status, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_assignments_one_active_member
  ON public.campaign_assignments(campaign_id, assigned_to_user_id)
  WHERE status IN ('assigned', 'in_progress');

CREATE TABLE IF NOT EXISTS public.campaign_assignment_homes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.campaign_assignments(id) ON DELETE CASCADE,
  campaign_address_id uuid NOT NULL REFERENCES public.campaign_addresses(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_assignment_homes_assignment_address_unique UNIQUE (assignment_id, campaign_address_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_assignment_homes_assignment
  ON public.campaign_assignment_homes(assignment_id, sequence);

CREATE INDEX IF NOT EXISTS idx_campaign_assignment_homes_address
  ON public.campaign_assignment_homes(campaign_address_id);

CREATE OR REPLACE FUNCTION public.campaign_assignment_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_campaign_assignments_touch_updated_at ON public.campaign_assignments;
CREATE TRIGGER trg_campaign_assignments_touch_updated_at
  BEFORE UPDATE ON public.campaign_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.campaign_assignment_touch_updated_at();

ALTER TABLE public.campaign_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_assignment_homes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaign_assignments_select_policy" ON public.campaign_assignments;
CREATE POLICY "campaign_assignments_select_policy"
ON public.campaign_assignments
FOR SELECT
TO authenticated
USING (
  assigned_to_user_id = auth.uid()
  OR public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner', 'admin'])
);

DROP POLICY IF EXISTS "campaign_assignments_all_service" ON public.campaign_assignments;
CREATE POLICY "campaign_assignments_all_service"
ON public.campaign_assignments
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "campaign_assignment_homes_select_policy" ON public.campaign_assignment_homes;
CREATE POLICY "campaign_assignment_homes_select_policy"
ON public.campaign_assignment_homes
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.campaign_assignments ca
    WHERE ca.id = campaign_assignment_homes.assignment_id
      AND (
        ca.assigned_to_user_id = auth.uid()
        OR public.has_workspace_role(ca.workspace_id, auth.uid(), ARRAY['owner', 'admin'])
      )
  )
);

DROP POLICY IF EXISTS "campaign_assignment_homes_all_service" ON public.campaign_assignment_homes;
CREATE POLICY "campaign_assignment_homes_all_service"
ON public.campaign_assignment_homes
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DO $$
BEGIN
  IF to_regclass('public.campaign_assignments') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_rel pr
       JOIN pg_class c ON c.oid = pr.prrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_publication p ON p.oid = pr.prpubid
       WHERE p.pubname = 'supabase_realtime'
         AND n.nspname = 'public'
         AND c.relname = 'campaign_assignments'
     ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.campaign_assignments';
  END IF;
END
$$;

COMMIT;
