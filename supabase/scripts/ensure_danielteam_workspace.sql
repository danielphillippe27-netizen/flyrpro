-- Run in Supabase: Dashboard → SQL Editor (auth.users is in the auth schema, not in Table Editor).
-- 1) Check that auth.users is readable and list relevant users (optional)
SELECT id, email, created_at
FROM auth.users
WHERE lower(email) LIKE '%danielteam%' OR lower(email) LIKE '%daniel%'
ORDER BY created_at DESC;

-- 2) Ensure danielteam@gmail.com has workspace + owner membership and lifelong access
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
    RAISE NOTICE 'No user with email danielteam@gmail.com in auth.users. Check Authentication → Users or run: SELECT id, email FROM auth.users;';
    RETURN;
  END IF;

  SELECT wm.workspace_id INTO v_workspace_id
  FROM public.workspace_members wm
  WHERE wm.user_id = v_user_id AND wm.role = 'owner'
  ORDER BY wm.created_at ASC
  LIMIT 1;

  IF v_workspace_id IS NULL THEN
    INSERT INTO public.workspaces (name, owner_id)
    VALUES ('My Workspace', v_user_id)
    RETURNING id INTO v_workspace_id;

    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (v_workspace_id, v_user_id, 'owner')
    ON CONFLICT (workspace_id, user_id)
    DO UPDATE SET role = 'owner', updated_at = now();

    RAISE NOTICE 'Created workspace % and owner membership for danielteam@gmail.com', v_workspace_id;
  END IF;

  UPDATE public.workspaces
  SET
    subscription_status = 'active',
    trial_ends_at = NULL,
    max_seats = GREATEST(COALESCE(max_seats, 1), 3),
    onboarding_completed_at = COALESCE(onboarding_completed_at, now())
  WHERE id = v_workspace_id;

  RAISE NOTICE 'Set lifelong access for workspace %', v_workspace_id;
END $$;
