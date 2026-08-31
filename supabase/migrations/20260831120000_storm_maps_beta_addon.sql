BEGIN;

ALTER TABLE public.workspace_billing_addons
  DROP CONSTRAINT IF EXISTS workspace_billing_addons_addon_key_check;

ALTER TABLE public.workspace_billing_addons
  ADD CONSTRAINT workspace_billing_addons_addon_key_check
  CHECK (addon_key IN ('power_dialer', 'storm_maps'));

COMMENT ON TABLE public.workspace_billing_addons IS
  'Workspace-scoped paid and beta add-ons. storm_maps uses a zero-cost active row during beta.';

COMMIT;
