-- Replace time-based workspace trials with one included campaign per free workspace.
-- Paid workspaces, ambassadors, founders, and service-role writes can create more.

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
        AND lower(coalesce(w.subscription_status, 'inactive')) = 'active'
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

CREATE OR REPLACE FUNCTION public.workspace_can_create_campaign(
  p_workspace_id uuid,
  p_owner_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign_count integer;
BEGIN
  IF p_workspace_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.workspace_has_paid_campaign_access(p_workspace_id, p_owner_id) THEN
    RETURN true;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0));

  SELECT count(*)
  INTO v_campaign_count
  FROM public.campaigns c
  WHERE c.workspace_id = p_workspace_id;

  RETURN coalesce(v_campaign_count, 0) < 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_workspace_campaign_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF public.workspace_can_create_campaign(NEW.workspace_id, NEW.owner_id) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'workspace_campaign_limit_reached'
    USING
      ERRCODE = 'P0001',
      DETAIL = 'This workspace already has its included campaign. Upgrade to create more campaigns.',
      HINT = 'workspace_campaign_limit_reached';
END;
$$;

DROP TRIGGER IF EXISTS enforce_workspace_campaign_limit_before_insert ON public.campaigns;
CREATE TRIGGER enforce_workspace_campaign_limit_before_insert
BEFORE INSERT ON public.campaigns
FOR EACH ROW
EXECUTE FUNCTION public.enforce_workspace_campaign_limit();

COMMENT ON FUNCTION public.workspace_has_paid_campaign_access(uuid, uuid)
  IS 'Returns true when a workspace/user context should bypass the free one-campaign limit.';

COMMENT ON FUNCTION public.workspace_can_create_campaign(uuid, uuid)
  IS 'Returns true when a workspace can insert another campaign under the one-free-campaign policy.';
