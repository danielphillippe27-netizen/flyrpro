-- Force-move danielmember@gmail.com onto danielteam@gmail.com's team workspace.
-- Idempotent and safe to run multiple times.

DO $$
DECLARE
  v_team_user_id uuid;
  v_member_user_id uuid;
  v_team_workspace_id uuid;
BEGIN
  SELECT id INTO v_team_user_id
  FROM auth.users
  WHERE lower(email) = lower('danielteam@gmail.com')
  LIMIT 1;

  SELECT id INTO v_member_user_id
  FROM auth.users
  WHERE lower(email) = lower('danielmember@gmail.com')
  LIMIT 1;

  IF v_team_user_id IS NULL OR v_member_user_id IS NULL THEN
    RAISE EXCEPTION 'Missing danielteam@gmail.com or danielmember@gmail.com in auth.users';
  END IF;

  -- Team workspace = earliest owner workspace for danielteam@gmail.com
  SELECT wm.workspace_id INTO v_team_workspace_id
  FROM public.workspace_members wm
  WHERE wm.user_id = v_team_user_id
    AND wm.role = 'owner'
  ORDER BY wm.created_at ASC
  LIMIT 1;

  IF v_team_workspace_id IS NULL THEN
    INSERT INTO public.workspaces (name, owner_id)
    VALUES ('Phillippe Group', v_team_user_id)
    RETURNING id INTO v_team_workspace_id;

    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (v_team_workspace_id, v_team_user_id, 'owner')
    ON CONFLICT (workspace_id, user_id)
    DO UPDATE SET role = 'owner', updated_at = now();
  END IF;

  -- Remove member from any other workspace so routing is deterministic
  DELETE FROM public.workspace_members
  WHERE user_id = v_member_user_id
    AND workspace_id <> v_team_workspace_id;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (v_team_workspace_id, v_member_user_id, 'member')
  ON CONFLICT (workspace_id, user_id)
  DO UPDATE SET role = 'member', updated_at = now();

  -- Ensure team workspace still has paid access + onboarding complete
  UPDATE public.workspaces
  SET
    name = 'Phillippe Group',
    industry = 'Real Estate',
    brokerage_name = 'REVEL REALTY INC',
    subscription_status = 'active',
    trial_ends_at = NULL,
    max_seats = GREATEST(COALESCE(max_seats, 1), 3),
    onboarding_completed_at = COALESCE(onboarding_completed_at, now()),
    updated_at = now()
  WHERE id = v_team_workspace_id;
END $$;
