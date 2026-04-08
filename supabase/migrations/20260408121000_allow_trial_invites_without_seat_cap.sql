BEGIN;

CREATE OR REPLACE FUNCTION public.assert_workspace_paid_seat_capacity(p_workspace_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_seats integer;
  v_active_paid_members integer;
  v_pending_paid_invites integer;
  v_subscription_status text;
  v_trial_ends_at timestamptz;
BEGIN
  SELECT
    GREATEST(COALESCE(w.max_seats, 1), 1),
    LOWER(COALESCE(w.subscription_status, '')),
    w.trial_ends_at
  INTO
    v_max_seats,
    v_subscription_status,
    v_trial_ends_at
  FROM public.workspaces w
  WHERE w.id = p_workspace_id
  FOR UPDATE;

  IF v_max_seats IS NULL THEN
    RETURN;
  END IF;

  IF v_subscription_status = 'trialing' AND (v_trial_ends_at IS NULL OR v_trial_ends_at > now()) THEN
    RETURN;
  END IF;

  SELECT COUNT(*)
  INTO v_active_paid_members
  FROM public.workspace_members wm
  WHERE wm.workspace_id = p_workspace_id
    AND wm.role <> 'admin';

  SELECT COUNT(*)
  INTO v_pending_paid_invites
  FROM public.workspace_invites wi
  WHERE wi.workspace_id = p_workspace_id
    AND wi.status = 'pending'
    AND wi.role <> 'admin'
    AND wi.expires_at > now();

  IF (v_active_paid_members + v_pending_paid_invites) >= v_max_seats THEN
    RAISE EXCEPTION 'workspace paid seat limit reached'
      USING ERRCODE = 'P0001',
            DETAIL = format(
              'workspace_id=%s, max_seats=%s, active_paid_members=%s, pending_paid_invites=%s',
              p_workspace_id,
              v_max_seats,
              v_active_paid_members,
              v_pending_paid_invites
            ),
            HINT = 'Increase max_seats before adding another paid member or pending member invite.';
  END IF;
END;
$$;

COMMIT;
