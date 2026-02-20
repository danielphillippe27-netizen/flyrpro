-- Ensure danielteam@gmail.com is owner of a single testing workspace.
-- Workspace is forced to "Phillippe Group" with paid access + onboarding complete.
--
-- Where is auth.users? It lives in the "auth" schema, not "public". In the dashboard:
--   - Left sidebar: Authentication → Users (list of auth.users)
--   - Or SQL Editor: SELECT id, email FROM auth.users;
-- Run this file in Supabase SQL Editor (Dashboard → SQL Editor) or via: npx supabase db push

DO $$
DECLARE
  v_user_id uuid;
  v_workspace_id uuid;
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower('danielteam@gmail.com')
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN; -- user not in auth.users yet
  END IF;

  -- Get or create workspace (owner membership implies workspace exists or we create it)
  SELECT wm.workspace_id INTO v_workspace_id
  FROM public.workspace_members wm
  WHERE wm.user_id = v_user_id AND wm.role = 'owner'
  ORDER BY wm.created_at ASC
  LIMIT 1;

  IF v_workspace_id IS NULL THEN
    INSERT INTO public.workspaces (name, owner_id)
    VALUES ('Phillippe Group', v_user_id)
    RETURNING id INTO v_workspace_id;
  END IF;

  -- Always keep danielteam as owner of the selected workspace
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (v_workspace_id, v_user_id, 'owner')
  ON CONFLICT (workspace_id, user_id)
  DO UPDATE SET role = 'owner', updated_at = now();

  -- Remove extra memberships for deterministic dashboard routing during testing
  DELETE FROM public.workspace_members
  WHERE user_id = v_user_id
    AND workspace_id <> v_workspace_id;

  -- Paid + onboarding complete + team defaults
  UPDATE public.workspaces
  SET
    name = 'Phillippe Group',
    owner_id = v_user_id,
    industry = 'Real Estate',
    brokerage_name = 'REVEL REALTY INC',
    subscription_status = 'active',
    trial_ends_at = NULL,
    max_seats = GREATEST(COALESCE(max_seats, 1), 3),
    onboarding_completed_at = COALESCE(onboarding_completed_at, now()),
    updated_at = now()
  WHERE id = v_workspace_id;
END $$;
