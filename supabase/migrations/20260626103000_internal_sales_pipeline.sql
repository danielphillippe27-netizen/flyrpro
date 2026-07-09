BEGIN;

ALTER TABLE public.salesperson_lead_master
  ADD COLUMN IF NOT EXISTS pipeline_stage text,
  ADD COLUMN IF NOT EXISTS pipeline_owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pipeline_priority text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS seat_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS estimated_monthly_value_cents integer NOT NULL DEFAULT 4000,
  ADD COLUMN IF NOT EXISTS next_task_title text,
  ADD COLUMN IF NOT EXISTS next_task_type text,
  ADD COLUMN IF NOT EXISTS last_touch_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_touch_summary text,
  ADD COLUMN IF NOT EXISTS objection text,
  ADD COLUMN IF NOT EXISTS trial_status text,
  ADD COLUMN IF NOT EXISTS trial_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS signed_up_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS signed_up_workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_product_active_at timestamptz,
  ADD COLUMN IF NOT EXISTS usage_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS match_confidence text;

UPDATE public.salesperson_lead_master
SET
  pipeline_stage = COALESCE(
    pipeline_stage,
    CASE lead_state
      WHEN 'attempting' THEN 'attempting_contact'
      WHEN 'contacted' THEN 'connected'
      WHEN 'interested' THEN 'connected'
      WHEN 'callback' THEN 'connected'
      WHEN 'converted' THEN 'won'
      WHEN 'archived' THEN 'nurture'
      WHEN 'dnc' THEN 'lost'
      WHEN 'not_now' THEN 'nurture'
      ELSE 'new_lead'
    END
  ),
  pipeline_owner_id = COALESCE(pipeline_owner_id, assigned_user_id),
  seat_count = GREATEST(COALESCE(seat_count, 1), 1),
  estimated_monthly_value_cents = GREATEST(COALESCE(estimated_monthly_value_cents, seat_count * 4000, 4000), 0);

ALTER TABLE public.salesperson_lead_master
  ALTER COLUMN pipeline_stage SET DEFAULT 'new_lead',
  ALTER COLUMN pipeline_stage SET NOT NULL,
  ALTER COLUMN pipeline_owner_id SET DEFAULT auth.uid();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'salesperson_lead_master_pipeline_stage_check'
  ) THEN
    ALTER TABLE public.salesperson_lead_master
      ADD CONSTRAINT salesperson_lead_master_pipeline_stage_check
      CHECK (pipeline_stage IN (
        'new_lead',
        'attempting_contact',
        'connected',
        'demo_sent',
        'trial_sent',
        'trial_active',
        'closing',
        'won',
        'lost',
        'nurture'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'salesperson_lead_master_pipeline_priority_check'
  ) THEN
    ALTER TABLE public.salesperson_lead_master
      ADD CONSTRAINT salesperson_lead_master_pipeline_priority_check
      CHECK (pipeline_priority IN ('low', 'normal', 'high', 'hot'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'salesperson_lead_master_seat_count_check'
  ) THEN
    ALTER TABLE public.salesperson_lead_master
      ADD CONSTRAINT salesperson_lead_master_seat_count_check
      CHECK (seat_count >= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'salesperson_lead_master_estimated_value_check'
  ) THEN
    ALTER TABLE public.salesperson_lead_master
      ADD CONSTRAINT salesperson_lead_master_estimated_value_check
      CHECK (estimated_monthly_value_cents >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'salesperson_lead_master_next_task_type_check'
  ) THEN
    ALTER TABLE public.salesperson_lead_master
      ADD CONSTRAINT salesperson_lead_master_next_task_type_check
      CHECK (
        next_task_type IS NULL OR next_task_type IN (
          'call',
          'text',
          'email',
          'dm',
          'demo_follow_up',
          'trial_check_in',
          'close_ask',
          'nurture'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'salesperson_lead_master_match_confidence_check'
  ) THEN
    ALTER TABLE public.salesperson_lead_master
      ADD CONSTRAINT salesperson_lead_master_match_confidence_check
      CHECK (
        match_confidence IS NULL OR match_confidence IN (
          'strong',
          'medium',
          'weak',
          'ambiguous'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS salesperson_lead_master_pipeline_board_idx
  ON public.salesperson_lead_master(workspace_id, pipeline_stage, next_follow_up_at, updated_at DESC);

CREATE INDEX IF NOT EXISTS salesperson_lead_master_pipeline_owner_idx
  ON public.salesperson_lead_master(workspace_id, pipeline_owner_id, pipeline_stage, next_follow_up_at);

CREATE INDEX IF NOT EXISTS salesperson_lead_master_signed_up_workspace_idx
  ON public.salesperson_lead_master(signed_up_workspace_id)
  WHERE signed_up_workspace_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.salesperson_lead_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.salesperson_lead_master(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  salesperson_id uuid REFERENCES public.salespeople(id) ON DELETE SET NULL,
  activity_type text NOT NULL CHECK (
    activity_type IN (
      'note',
      'call',
      'text',
      'email',
      'stage_change',
      'task_change',
      'demo_opened',
      'signup',
      'usage_milestone',
      'match_review'
    )
  ),
  title text NOT NULL,
  body text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS salesperson_lead_activities_lead_created_idx
  ON public.salesperson_lead_activities(lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS salesperson_lead_activities_workspace_created_idx
  ON public.salesperson_lead_activities(workspace_id, created_at DESC);

ALTER TABLE public.salesperson_lead_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS salesperson_lead_activities_workspace_members_select ON public.salesperson_lead_activities;
CREATE POLICY salesperson_lead_activities_workspace_members_select
ON public.salesperson_lead_activities
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = salesperson_lead_activities.workspace_id
      AND wm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS salesperson_lead_activities_workspace_members_insert ON public.salesperson_lead_activities;
CREATE POLICY salesperson_lead_activities_workspace_members_insert
ON public.salesperson_lead_activities
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = salesperson_lead_activities.workspace_id
      AND wm.user_id = auth.uid()
  )
);

CREATE TABLE IF NOT EXISTS public.salesperson_lead_app_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.salesperson_lead_master(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  matched_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  matched_workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  demo_link_id uuid REFERENCES public.salesperson_demo_links(id) ON DELETE SET NULL,
  salesperson_id uuid REFERENCES public.salespeople(id) ON DELETE SET NULL,
  match_method text NOT NULL CHECK (match_method IN ('invite_link', 'email', 'phone')),
  match_confidence text NOT NULL CHECK (match_confidence IN ('strong', 'medium', 'weak', 'ambiguous')),
  matched_email text,
  matched_phone_e164 text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  auto_applied boolean NOT NULL DEFAULT false,
  reviewed_at timestamptz,
  reviewed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS salesperson_lead_app_matches_lead_created_idx
  ON public.salesperson_lead_app_matches(lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS salesperson_lead_app_matches_workspace_created_idx
  ON public.salesperson_lead_app_matches(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS salesperson_lead_app_matches_matched_workspace_idx
  ON public.salesperson_lead_app_matches(matched_workspace_id)
  WHERE matched_workspace_id IS NOT NULL;

ALTER TABLE public.salesperson_lead_app_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS salesperson_lead_app_matches_workspace_members_select ON public.salesperson_lead_app_matches;
CREATE POLICY salesperson_lead_app_matches_workspace_members_select
ON public.salesperson_lead_app_matches
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = salesperson_lead_app_matches.workspace_id
      AND wm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS salesperson_lead_app_matches_service_role_all ON public.salesperson_lead_app_matches;
CREATE POLICY salesperson_lead_app_matches_service_role_all
ON public.salesperson_lead_app_matches
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.salesperson_lead_master_pipeline_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.pipeline_stage = COALESCE(NEW.pipeline_stage, 'new_lead');
  NEW.pipeline_priority = COALESCE(NEW.pipeline_priority, 'normal');
  NEW.pipeline_owner_id = COALESCE(NEW.pipeline_owner_id, NEW.assigned_user_id);
  NEW.seat_count = GREATEST(COALESCE(NEW.seat_count, 1), 1);

  IF TG_OP = 'INSERT'
    AND (NEW.estimated_monthly_value_cents IS NULL OR NEW.estimated_monthly_value_cents = 4000)
  THEN
    NEW.estimated_monthly_value_cents = NEW.seat_count * 4000;
  ELSIF TG_OP = 'UPDATE'
    AND NEW.seat_count IS DISTINCT FROM OLD.seat_count
    AND NEW.estimated_monthly_value_cents IS NOT DISTINCT FROM OLD.estimated_monthly_value_cents
  THEN
    NEW.estimated_monthly_value_cents = NEW.seat_count * 4000;
  ELSE
    NEW.estimated_monthly_value_cents = COALESCE(NEW.estimated_monthly_value_cents, NEW.seat_count * 4000, 4000);
  END IF;

  NEW.estimated_monthly_value_cents = GREATEST(NEW.estimated_monthly_value_cents, 0);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS salesperson_lead_master_pipeline_defaults ON public.salesperson_lead_master;
CREATE TRIGGER salesperson_lead_master_pipeline_defaults
BEFORE INSERT OR UPDATE ON public.salesperson_lead_master
FOR EACH ROW
EXECUTE FUNCTION public.salesperson_lead_master_pipeline_defaults();

COMMENT ON COLUMN public.salesperson_lead_master.seat_count IS 'Estimated paid seats for this internal FLYR sales lead. Pricing defaults to $40/mo per seat.';
COMMENT ON COLUMN public.salesperson_lead_master.match_confidence IS 'Best current app signup match confidence. Only strong matches should auto-update pipeline state.';
COMMENT ON TABLE public.salesperson_lead_activities IS 'Internal sales lead timeline for notes, task changes, stage changes, demo opens, signups, and product usage milestones.';
COMMENT ON TABLE public.salesperson_lead_app_matches IS 'Attribution history between internal sales leads and app signups/workspaces.';

COMMIT;
