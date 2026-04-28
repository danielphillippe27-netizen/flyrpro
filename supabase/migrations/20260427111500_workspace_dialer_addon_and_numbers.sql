BEGIN;

CREATE TABLE IF NOT EXISTS public.workspace_billing_addons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  addon_key text NOT NULL CHECK (addon_key IN ('power_dialer')),
  status text NOT NULL DEFAULT 'inactive' CHECK (status IN ('inactive', 'active', 'past_due', 'canceled')),
  stripe_subscription_id text,
  stripe_subscription_item_id text,
  stripe_price_id text,
  quantity integer NOT NULL DEFAULT 1,
  amount_cents integer,
  currency text,
  activated_at timestamptz,
  canceled_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, addon_key)
);

ALTER TABLE public.workspace_dialer_settings
  ADD COLUMN IF NOT EXISTS inbound_forward_to text,
  ADD COLUMN IF NOT EXISTS twilio_incoming_phone_number_sid text,
  ADD COLUMN IF NOT EXISTS number_status text NOT NULL DEFAULT 'unassigned'
    CHECK (number_status IN ('unassigned', 'active', 'released')),
  ADD COLUMN IF NOT EXISTS number_assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS provisioning_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_workspace_billing_addons_workspace_status
  ON public.workspace_billing_addons(workspace_id, status);

ALTER TABLE public.workspace_billing_addons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_billing_addons_member_read" ON public.workspace_billing_addons;
CREATE POLICY "workspace_billing_addons_member_read"
  ON public.workspace_billing_addons FOR SELECT
  USING (workspace_id = ANY(public.current_user_workspace_ids()));

DROP POLICY IF EXISTS "workspace_billing_addons_owner_admin_manage" ON public.workspace_billing_addons;
CREATE POLICY "workspace_billing_addons_owner_admin_manage"
  ON public.workspace_billing_addons FOR ALL
  USING (public.is_workspace_owner_or_admin(workspace_id))
  WITH CHECK (public.is_workspace_owner_or_admin(workspace_id));

COMMIT;
