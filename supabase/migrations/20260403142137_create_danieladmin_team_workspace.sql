-- Ensure danieladmin@gmail.com exists as an admin inside danielteam@gmail.com's workspace.
-- This keeps local role testing deterministic now that admin seats are treated as free.

DO $$
DECLARE
  v_team_user_id uuid;
  v_admin_user_id uuid;
  v_team_workspace_id uuid;
BEGIN
  SELECT id INTO v_team_user_id
  FROM auth.users
  WHERE lower(email) = lower('danielteam@gmail.com')
  LIMIT 1;

  SELECT id INTO v_admin_user_id
  FROM auth.users
  WHERE lower(email) = lower('danieladmin@gmail.com')
  LIMIT 1;

  IF v_team_user_id IS NULL OR v_admin_user_id IS NULL THEN
    RAISE NOTICE 'Skipping admin workspace seed because danielteam@gmail.com or danieladmin@gmail.com is missing from auth.users. Create both users in Authentication -> Users, then rerun this migration.';
    RETURN;
  END IF;

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

  INSERT INTO public.user_profiles (
    user_id,
    weekly_door_goal,
    first_name,
    last_name,
    industry,
    brokerage_name,
    is_founder,
    current_workspace_id
  )
  VALUES (
    v_admin_user_id,
    100,
    'Daniel',
    'Admin',
    'Real Estate',
    'REVEL REALTY INC',
    false,
    v_team_workspace_id
  )
  ON CONFLICT (user_id) DO UPDATE
    SET
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      industry = EXCLUDED.industry,
      brokerage_name = EXCLUDED.brokerage_name,
      is_founder = false,
      current_workspace_id = EXCLUDED.current_workspace_id,
      weekly_door_goal = COALESCE(public.user_profiles.weekly_door_goal, EXCLUDED.weekly_door_goal);

  DELETE FROM public.workspace_members
  WHERE user_id = v_admin_user_id
    AND workspace_id <> v_team_workspace_id;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (v_team_workspace_id, v_admin_user_id, 'admin')
  ON CONFLICT (workspace_id, user_id)
  DO UPDATE SET role = 'admin', updated_at = now();

  UPDATE public.workspaces
  SET
    name = 'Phillippe Group',
    industry = 'Real Estate',
    brokerage_name = 'REVEL REALTY INC',
    subscription_status = 'active',
    trial_ends_at = NULL,
    onboarding_completed_at = COALESCE(onboarding_completed_at, now()),
    updated_at = now()
  WHERE id = v_team_workspace_id;
END $$;
