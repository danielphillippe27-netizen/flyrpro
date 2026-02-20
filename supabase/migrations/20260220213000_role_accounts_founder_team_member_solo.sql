-- Provision role test accounts across founder/team/member/solo-owner scenarios.
--
-- IMPORTANT:
-- 1) Create these users first in Supabase Auth (Authentication -> Users), using password: megs1989
--    - danielfounder@gmail.com
--    - danielteam@gmail.com
--    - danielmember@gmail.com
--    - danielsolo@gmail.com
-- 2) Then run this SQL.
--
-- Resulting role model in this app:
-- - Founder: user_profiles.is_founder = true (redirected to founder dashboard)
-- - Team lead: workspace owner with >1 member in workspace
-- - Member: workspace_members.role = 'member'
-- - Solo owner: workspace owner with only themselves in workspace
-- This migration enforces deterministic roles by resetting memberships for these 4 users.
--
-- Workspaces are set "paid" for gate checks:
-- subscription_status = 'active', trial_ends_at = NULL, onboarding_completed_at set.

DO $$
DECLARE
  v_founder_id uuid;
  v_team_lead_id uuid;
  v_member_id uuid;
  v_solo_id uuid;

  v_founder_ws_id uuid;
  v_team_ws_id uuid;
  v_solo_ws_id uuid;

  v_brokerage_id uuid;
BEGIN
  -- Resolve required users from auth.users
  SELECT id INTO v_founder_id
  FROM auth.users
  WHERE lower(email) = lower('danielfounder@gmail.com')
  LIMIT 1;

  SELECT id INTO v_team_lead_id
  FROM auth.users
  WHERE lower(email) = lower('danielteam@gmail.com')
  LIMIT 1;

  SELECT id INTO v_member_id
  FROM auth.users
  WHERE lower(email) = lower('danielmember@gmail.com')
  LIMIT 1;

  SELECT id INTO v_solo_id
  FROM auth.users
  WHERE lower(email) = lower('danielsolo@gmail.com')
  LIMIT 1;

  IF v_founder_id IS NULL OR v_team_lead_id IS NULL OR v_member_id IS NULL OR v_solo_id IS NULL THEN
    RAISE EXCEPTION
      'Missing one or more auth users. Create all four users in Authentication -> Users first, with password "megs1989".';
  END IF;

  -- Canonical brokerage id when present
  SELECT id INTO v_brokerage_id
  FROM public.brokerages
  WHERE lower(name) = lower('REVEL REALTY INC')
  LIMIT 1;

  -- Ensure user_profiles rows and role-specific metadata
  INSERT INTO public.user_profiles (
    user_id,
    weekly_door_goal,
    first_name,
    last_name,
    industry,
    brokerage_name,
    is_founder
  )
  VALUES
    (v_founder_id, 100, 'Daniel', 'Founder', 'Real Estate', 'REVEL REALTY INC', true),
    (v_team_lead_id, 100, 'Daniel', 'Team', 'Real Estate', 'REVEL REALTY INC', false),
    (v_member_id, 100, 'Daniel', 'Member', 'Real Estate', 'REVEL REALTY INC', false),
    (v_solo_id, 100, 'Daniel', 'Solo', 'Real Estate', 'REVEL REALTY INC', false)
  ON CONFLICT (user_id) DO UPDATE
    SET
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      industry = EXCLUDED.industry,
      brokerage_name = EXCLUDED.brokerage_name,
      weekly_door_goal = COALESCE(public.user_profiles.weekly_door_goal, EXCLUDED.weekly_door_goal),
      is_founder = EXCLUDED.is_founder;

  -- Workspace 1: Founder workspace (founder owner; founder dashboard via is_founder=true)
  SELECT wm.workspace_id INTO v_founder_ws_id
  FROM public.workspace_members wm
  WHERE wm.user_id = v_founder_id
    AND wm.role = 'owner'
  ORDER BY wm.created_at ASC
  LIMIT 1;

  IF v_founder_ws_id IS NULL THEN
    INSERT INTO public.workspaces (name, owner_id)
    VALUES ('Phillippe Group', v_founder_id)
    RETURNING id INTO v_founder_ws_id;
  END IF;

  -- Workspace 2: Team workspace (team lead owner + member user as member)
  SELECT wm.workspace_id INTO v_team_ws_id
  FROM public.workspace_members wm
  WHERE wm.user_id = v_team_lead_id
    AND wm.role = 'owner'
  ORDER BY wm.created_at ASC
  LIMIT 1;

  IF v_team_ws_id IS NULL THEN
    INSERT INTO public.workspaces (name, owner_id)
    VALUES ('Phillippe Group', v_team_lead_id)
    RETURNING id INTO v_team_ws_id;
  END IF;

  -- Workspace 3: Solo owner workspace (solo user owner only)
  SELECT wm.workspace_id INTO v_solo_ws_id
  FROM public.workspace_members wm
  WHERE wm.user_id = v_solo_id
    AND wm.role = 'owner'
  ORDER BY wm.created_at ASC
  LIMIT 1;

  IF v_solo_ws_id IS NULL THEN
    INSERT INTO public.workspaces (name, owner_id)
    VALUES ('Phillippe Group', v_solo_id)
    RETURNING id INTO v_solo_ws_id;
  END IF;

  -- Reset memberships so role routing is deterministic for testing:
  -- founder -> owner in founder workspace
  -- team lead -> owner in team workspace
  -- member -> member in team workspace (and not owner anywhere)
  -- solo -> owner in solo workspace
  DELETE FROM public.workspace_members
  WHERE user_id IN (v_founder_id, v_team_lead_id, v_member_id, v_solo_id);

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES
    (v_founder_ws_id, v_founder_id, 'owner'),
    (v_team_ws_id, v_team_lead_id, 'owner'),
    (v_team_ws_id, v_member_id, 'member'),
    (v_solo_ws_id, v_solo_id, 'owner')
  ON CONFLICT (workspace_id, user_id)
  DO UPDATE SET role = EXCLUDED.role, updated_at = now();

  -- Founder workspace: paid + onboarding complete
  UPDATE public.workspaces
  SET
    owner_id = v_founder_id,
    name = 'Phillippe Group',
    industry = 'Real Estate',
    brokerage_id = COALESCE(v_brokerage_id, brokerage_id),
    brokerage_name = 'REVEL REALTY INC',
    subscription_status = 'active',
    trial_ends_at = NULL,
    max_seats = GREATEST(COALESCE(max_seats, 1), 3),
    onboarding_completed_at = COALESCE(onboarding_completed_at, now()),
    updated_at = now()
  WHERE id = v_founder_ws_id;

  -- Team workspace: paid + onboarding complete
  UPDATE public.workspaces
  SET
    owner_id = v_team_lead_id,
    name = 'Phillippe Group',
    industry = 'Real Estate',
    brokerage_id = COALESCE(v_brokerage_id, brokerage_id),
    brokerage_name = 'REVEL REALTY INC',
    subscription_status = 'active',
    trial_ends_at = NULL,
    max_seats = GREATEST(COALESCE(max_seats, 1), 3),
    onboarding_completed_at = COALESCE(onboarding_completed_at, now()),
    updated_at = now()
  WHERE id = v_team_ws_id;

  -- Solo workspace: paid + onboarding complete
  UPDATE public.workspaces
  SET
    owner_id = v_solo_id,
    name = 'Phillippe Group',
    industry = 'Real Estate',
    brokerage_id = COALESCE(v_brokerage_id, brokerage_id),
    brokerage_name = 'REVEL REALTY INC',
    subscription_status = 'active',
    trial_ends_at = NULL,
    max_seats = GREATEST(COALESCE(max_seats, 1), 1),
    onboarding_completed_at = COALESCE(onboarding_completed_at, now()),
    updated_at = now()
  WHERE id = v_solo_ws_id;
END $$;

-- Optional verification:
-- SELECT u.email, up.is_founder, wm.role, w.name, w.subscription_status, w.onboarding_completed_at, w.max_seats
-- FROM auth.users u
-- LEFT JOIN public.user_profiles up ON up.user_id = u.id
-- LEFT JOIN public.workspace_members wm ON wm.user_id = u.id
-- LEFT JOIN public.workspaces w ON w.id = wm.workspace_id
-- WHERE lower(u.email) IN (
--   lower('danielfounder@gmail.com'),
--   lower('danielteam@gmail.com'),
--   lower('danielmember@gmail.com'),
--   lower('danielsolo@gmail.com')
-- )
-- ORDER BY u.email, wm.role;
