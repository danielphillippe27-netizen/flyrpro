BEGIN;

ALTER TABLE public.salespeople
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS salespeople_user_id_idx
  ON public.salespeople (user_id)
  WHERE user_id IS NOT NULL;

UPDATE public.salespeople s
SET user_id = u.id
FROM auth.users u
WHERE s.user_id IS NULL
  AND lower(s.email) = lower(u.email);

CREATE TABLE IF NOT EXISTS public.salesperson_dialer_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salesperson_id uuid NOT NULL UNIQUE REFERENCES public.salespeople(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  assigned_phone_number text,
  default_sms_from_number text,
  inbound_forward_to text,
  twilio_incoming_phone_number_sid text,
  number_status text NOT NULL DEFAULT 'unassigned'
    CHECK (number_status IN ('unassigned', 'active', 'released')),
  number_assigned_at timestamptz,
  provisioning_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS salesperson_dialer_settings_workspace_idx
  ON public.salesperson_dialer_settings (workspace_id);

CREATE INDEX IF NOT EXISTS salesperson_dialer_settings_phone_idx
  ON public.salesperson_dialer_settings (assigned_phone_number)
  WHERE assigned_phone_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS salesperson_dialer_settings_sms_phone_idx
  ON public.salesperson_dialer_settings (default_sms_from_number)
  WHERE default_sms_from_number IS NOT NULL;

CREATE OR REPLACE FUNCTION public.salesperson_dialer_settings_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS salesperson_dialer_settings_set_updated_at
  ON public.salesperson_dialer_settings;
CREATE TRIGGER salesperson_dialer_settings_set_updated_at
BEFORE UPDATE ON public.salesperson_dialer_settings
FOR EACH ROW EXECUTE FUNCTION public.salesperson_dialer_settings_set_updated_at();

ALTER TABLE public.salesperson_dialer_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS salesperson_dialer_settings_workspace_members_select
  ON public.salesperson_dialer_settings;
CREATE POLICY salesperson_dialer_settings_workspace_members_select
ON public.salesperson_dialer_settings
FOR SELECT
USING (workspace_id = ANY(public.current_user_workspace_ids()));

DROP POLICY IF EXISTS salesperson_dialer_settings_owner_admin_manage
  ON public.salesperson_dialer_settings;
CREATE POLICY salesperson_dialer_settings_owner_admin_manage
ON public.salesperson_dialer_settings
FOR ALL
USING (public.is_workspace_owner_or_admin(workspace_id))
WITH CHECK (public.is_workspace_owner_or_admin(workspace_id));

ALTER TABLE public.dialer_inbound_messages
  ADD COLUMN IF NOT EXISTS salesperson_id uuid REFERENCES public.salespeople(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dialer_inbound_messages_salesperson_received
  ON public.dialer_inbound_messages(salesperson_id, received_at DESC)
  WHERE salesperson_id IS NOT NULL;

DO $$
DECLARE
  v_daniel_user_id uuid;
  v_workspace_id uuid;
  v_now timestamptz := now();
BEGIN
  SELECT id
  INTO v_daniel_user_id
  FROM auth.users
  WHERE lower(email) = 'danielsales@gmail.com'
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_daniel_user_id IS NULL THEN
    RAISE NOTICE 'danielsales@gmail.com does not exist yet; skipping shared salesperson workspace backfill.';
    RETURN;
  END IF;

  SELECT wm.workspace_id
  INTO v_workspace_id
  FROM public.workspace_members wm
  JOIN public.workspaces w ON w.id = wm.workspace_id
  WHERE wm.user_id = v_daniel_user_id
    AND wm.role = 'owner'
  ORDER BY
    CASE
      WHEN lower(w.name) IN ('daniel sales workspace', 'flyr sales workspace', 'salesperson workspace') THEN 0
      ELSE 1
    END,
    w.created_at ASC
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
      'Daniel Sales Workspace',
      v_daniel_user_id,
      'real_estate',
      'active',
      200,
      v_now
    )
    RETURNING id INTO v_workspace_id;
  ELSE
    UPDATE public.workspaces
    SET
      owner_id = v_daniel_user_id,
      subscription_status = 'active',
      max_seats = GREATEST(COALESCE(max_seats, 1), 200),
      onboarding_completed_at = COALESCE(onboarding_completed_at, v_now),
      updated_at = v_now
    WHERE id = v_workspace_id;
  END IF;

  INSERT INTO public.workspace_members (workspace_id, user_id, role, updated_at)
  VALUES (v_workspace_id, v_daniel_user_id, 'owner', v_now)
  ON CONFLICT (workspace_id, user_id)
  DO UPDATE SET role = 'owner', updated_at = v_now;

  INSERT INTO public.user_profiles (user_id, current_workspace_id)
  VALUES (v_daniel_user_id, v_workspace_id)
  ON CONFLICT (user_id)
  DO UPDATE SET current_workspace_id = v_workspace_id;

  UPDATE public.salespeople
  SET
    founder_user_id = v_daniel_user_id,
    workspace_id = v_workspace_id,
    updated_at = v_now
  WHERE status IN ('active', 'paused', 'inactive');

  INSERT INTO public.workspace_members (workspace_id, user_id, role, updated_at)
  SELECT DISTINCT ON (s.user_id)
    v_workspace_id,
    s.user_id,
    'member',
    v_now
  FROM public.salespeople s
  WHERE s.user_id IS NOT NULL
  ORDER BY s.user_id, s.updated_at DESC NULLS LAST, s.created_at DESC NULLS LAST
  ON CONFLICT (workspace_id, user_id)
  DO UPDATE SET
    role = CASE
      WHEN workspace_members.user_id = v_daniel_user_id THEN 'owner'
      ELSE 'member'
    END,
    updated_at = v_now;

  INSERT INTO public.user_profiles (user_id, current_workspace_id)
  SELECT DISTINCT ON (s.user_id)
    s.user_id,
    v_workspace_id
  FROM public.salespeople s
  WHERE s.user_id IS NOT NULL
  ORDER BY s.user_id, s.updated_at DESC NULLS LAST, s.created_at DESC NULLS LAST
  ON CONFLICT (user_id)
  DO UPDATE SET current_workspace_id = v_workspace_id;

  INSERT INTO public.workspace_billing_addons (
    workspace_id,
    addon_key,
    status,
    quantity,
    activated_at,
    updated_at
  )
  VALUES (v_workspace_id, 'power_dialer', 'active', 1, v_now, v_now)
  ON CONFLICT (workspace_id, addon_key)
  DO UPDATE SET
    status = 'active',
    quantity = GREATEST(public.workspace_billing_addons.quantity, 1),
    activated_at = COALESCE(public.workspace_billing_addons.activated_at, v_now),
    updated_at = v_now;

  INSERT INTO public.workspace_dialer_settings (
    workspace_id,
    enabled,
    allow_sms_followup,
    updated_at
  )
  VALUES (v_workspace_id, true, true, v_now)
  ON CONFLICT (workspace_id)
  DO UPDATE SET
    enabled = true,
    allow_sms_followup = true,
    updated_at = v_now;

  INSERT INTO public.salesperson_dialer_settings (salesperson_id, workspace_id)
  SELECT s.id, v_workspace_id
  FROM public.salespeople s
  WHERE s.workspace_id = v_workspace_id
  ON CONFLICT (salesperson_id)
  DO UPDATE SET workspace_id = EXCLUDED.workspace_id;
END $$;

COMMIT;
