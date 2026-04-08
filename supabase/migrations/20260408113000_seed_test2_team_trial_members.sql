-- Add two additional member seats/users for "Test 2 Team workspace" trial testing.
DO $$
DECLARE
  v_workspace_id uuid;
  v_user_id uuid;
  v_email text;
  v_emails text[] := ARRAY[
    'danieladmin@gmail.com',
    'danielsolo@gmail.com'
  ];
BEGIN
  SELECT id
  INTO v_workspace_id
  FROM public.workspaces
  WHERE lower(name) = lower('Test 2 Team workspace')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_workspace_id IS NULL THEN
    RAISE NOTICE 'Skipping Test 2 Team workspace seed: workspace not found.';
    RETURN;
  END IF;

  UPDATE public.workspaces
  SET
    subscription_status = 'trialing',
    trial_ends_at = COALESCE(
      trial_ends_at,
      (now() + interval '14 days')
    ),
    max_seats = GREATEST(COALESCE(max_seats, 1), 4),
    onboarding_completed_at = COALESCE(onboarding_completed_at, now()),
    updated_at = now()
  WHERE id = v_workspace_id;

  FOREACH v_email IN ARRAY v_emails LOOP
    SELECT id
    INTO v_user_id
    FROM auth.users
    WHERE lower(email) = lower(v_email)
    LIMIT 1;

    IF v_user_id IS NULL THEN
      RAISE NOTICE 'Skipping member seed for %, user not found in auth.users.', v_email;
      CONTINUE;
    END IF;

    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (v_workspace_id, v_user_id, 'member')
    ON CONFLICT (workspace_id, user_id)
    DO UPDATE
      SET
        role = CASE
          WHEN public.workspace_members.role IN ('owner', 'admin') THEN public.workspace_members.role
          ELSE 'member'
        END,
        updated_at = now();
  END LOOP;
END $$;
