-- Keep the one-included-campaign free plan while allowing explicitly granted,
-- time-boxed workspace trials (such as the demo-44 team trial) to use Pro access.

CREATE OR REPLACE FUNCTION public.workspace_has_paid_campaign_access(
  p_workspace_id uuid,
  p_owner_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.workspaces w
      WHERE w.id = p_workspace_id
        AND (
          lower(coalesce(w.subscription_status, 'inactive')) = 'active'
          OR (
            lower(coalesce(w.subscription_status, 'inactive')) = 'trialing'
            AND w.trial_ends_at IS NOT NULL
            AND w.trial_ends_at > now()
          )
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.entitlements e
      WHERE e.user_id = coalesce(p_owner_id, auth.uid())
        AND e.is_active = true
        AND e.plan IN ('pro', 'team', 'ambassador')
        AND (e.current_period_end IS NULL OR e.current_period_end > now())
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.user_id = coalesce(p_owner_id, auth.uid())
        AND up.is_founder = true
    );
$$;

COMMENT ON FUNCTION public.workspace_has_paid_campaign_access(uuid, uuid)
  IS 'Returns true for paid workspaces, unexpired explicit trials, active entitlements, and founders.';
