-- Workspace subscription/onboarding columns and access helpers for hard paywall.
-- Idempotent; run after workspace_multitenancy_phase1.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) user_profiles: first_name, last_name for onboarding
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS last_name text;

-- ---------------------------------------------------------------------------
-- 2) workspaces: subscription and onboarding metadata
-- ---------------------------------------------------------------------------
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS industry text;
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'inactive'
  CHECK (subscription_status IN ('inactive', 'trialing', 'active', 'past_due'));
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS max_seats integer NOT NULL DEFAULT 1;
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS referral_code_used text;

-- Backfill: existing workspaces get onboarding_completed_at = created_at so current users are not forced through wizard
UPDATE public.workspaces
SET onboarding_completed_at = COALESCE(onboarding_completed_at, created_at)
WHERE onboarding_completed_at IS NULL;

-- Default for new columns where we added NOT NULL with DEFAULT - no-op for existing rows

CREATE INDEX IF NOT EXISTS idx_workspaces_subscription_status
  ON public.workspaces(subscription_status);

-- ---------------------------------------------------------------------------
-- 3) Helper: whether workspace has active/trialing subscription (dashboard access)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workspace_subscription_active(ws_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces w
    WHERE w.id = ws_id
      AND w.subscription_status IN ('active', 'trialing')
      AND (w.trial_ends_at IS NULL OR w.trial_ends_at > now())
  )
$$;

-- For trialing, consider expired trial as inactive
CREATE OR REPLACE FUNCTION public.workspace_has_dashboard_access(ws_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces w
    WHERE w.id = ws_id
      AND (
        w.subscription_status = 'active'
        OR (w.subscription_status = 'trialing' AND (w.trial_ends_at IS NULL OR w.trial_ends_at > now()))
      )
  )
$$;

COMMENT ON FUNCTION public.workspace_has_dashboard_access(uuid) IS 'True if workspace subscription is active or in valid trial; used for hard paywall gate.';

COMMIT;
