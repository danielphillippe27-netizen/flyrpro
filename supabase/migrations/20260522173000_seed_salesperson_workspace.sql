CREATE INDEX IF NOT EXISTS salespeople_email_lower_lookup_idx
  ON public.salespeople ((lower(email)));

DO $$
DECLARE
  v_workspace_id uuid;
  v_user record;
BEGIN
  UPDATE public.salespeople
  SET
    full_name = 'Harry David Brown',
    email = 'harrydavidbrown@icloud.com',
    role = COALESCE(role, 'Salesperson'),
    referral_code = COALESCE(referral_code, 'HARRY'),
    commission_rate_bps = COALESCE(commission_rate_bps, 2500),
    status = 'active',
    approved_at = COALESCE(approved_at, now()),
    notes = COALESCE(notes, 'Seeded salesperson account.')
  WHERE lower(email) = 'harrydavidbrown@icloud.com';

  IF NOT FOUND THEN
    INSERT INTO public.salespeople (
      full_name,
      email,
      role,
      referral_code,
      commission_rate_bps,
      status,
      approved_at,
      notes
    )
    VALUES (
      'Harry David Brown',
      'harrydavidbrown@icloud.com',
      'Salesperson',
      'HARRY',
      2500,
      'active',
      now(),
      'Seeded salesperson account.'
    );
  END IF;

  UPDATE public.salespeople
  SET
    full_name = 'Fliper 27',
    email = 'fliper27@icloud.com',
    role = COALESCE(role, 'Salesperson'),
    referral_code = COALESCE(referral_code, 'FLIPER27'),
    commission_rate_bps = COALESCE(commission_rate_bps, 2500),
    status = 'active',
    approved_at = COALESCE(approved_at, now()),
    notes = COALESCE(notes, 'Seeded salesperson account.')
  WHERE lower(email) = 'fliper27@icloud.com';

  IF NOT FOUND THEN
    INSERT INTO public.salespeople (
      full_name,
      email,
      role,
      referral_code,
      commission_rate_bps,
      status,
      approved_at,
      notes
    )
    VALUES (
      'Fliper 27',
      'fliper27@icloud.com',
      'Salesperson',
      'FLIPER27',
      2500,
      'active',
      now(),
      'Seeded salesperson account.'
    );
  END IF;

  SELECT id
  INTO v_workspace_id
  FROM public.workspaces
  WHERE name = 'Salesperson Workspace'
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_workspace_id IS NULL THEN
    INSERT INTO public.workspaces (
      name,
      owner_id,
      industry,
      subscription_status,
      max_seats,
      onboarding_completed_at
    )
    VALUES (
      'Salesperson Workspace',
      NULL,
      'real_estate',
      'active',
      10,
      now()
    )
    RETURNING id INTO v_workspace_id;
  ELSE
    UPDATE public.workspaces
    SET
      subscription_status = 'active',
      max_seats = GREATEST(max_seats, 10),
      onboarding_completed_at = COALESCE(onboarding_completed_at, now())
    WHERE id = v_workspace_id;
  END IF;

  FOR v_user IN
    SELECT id
    FROM auth.users
    WHERE lower(email) IN ('harrydavidbrown@icloud.com', 'fliper27@icloud.com')
  LOOP
    INSERT INTO public.user_profiles (
      user_id,
      weekly_door_goal,
      is_founder,
      current_workspace_id
    )
    VALUES (
      v_user.id,
      100,
      false,
      v_workspace_id
    )
    ON CONFLICT (user_id) DO UPDATE
      SET current_workspace_id = v_workspace_id;

    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (v_workspace_id, v_user.id, 'member')
    ON CONFLICT (workspace_id, user_id)
    DO UPDATE SET role = 'member', updated_at = now();
  END LOOP;
END $$;
