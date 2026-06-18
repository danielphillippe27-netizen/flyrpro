BEGIN;

CREATE TABLE IF NOT EXISTS public.onboarding_demo_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_path text NOT NULL CHECK (role_path IN ('team_owner', 'solo_owner', 'member')),
  seeded_campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  completed_items jsonb NOT NULL DEFAULT '{}'::jsonb,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_demo_states_workspace_user_unique UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_demo_states_workspace_id
  ON public.onboarding_demo_states(workspace_id);

CREATE INDEX IF NOT EXISTS idx_onboarding_demo_states_user_id
  ON public.onboarding_demo_states(user_id);

CREATE OR REPLACE FUNCTION public.onboarding_demo_states_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_onboarding_demo_states_touch_updated_at ON public.onboarding_demo_states;
CREATE TRIGGER trg_onboarding_demo_states_touch_updated_at
  BEFORE UPDATE ON public.onboarding_demo_states
  FOR EACH ROW
  EXECUTE FUNCTION public.onboarding_demo_states_touch_updated_at();

ALTER TABLE public.onboarding_demo_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "onboarding_demo_states_workspace_members_select" ON public.onboarding_demo_states;
CREATE POLICY "onboarding_demo_states_workspace_members_select"
ON public.onboarding_demo_states
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = onboarding_demo_states.workspace_id
      AND wm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "onboarding_demo_states_workspace_members_update_own" ON public.onboarding_demo_states;
CREATE POLICY "onboarding_demo_states_workspace_members_update_own"
ON public.onboarding_demo_states
FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = onboarding_demo_states.workspace_id
      AND wm.user_id = auth.uid()
  )
)
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = onboarding_demo_states.workspace_id
      AND wm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "onboarding_demo_states_service_role_all" ON public.onboarding_demo_states;
CREATE POLICY "onboarding_demo_states_service_role_all"
ON public.onboarding_demo_states
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

COMMIT;
