-- Keep the production Sales rollout workspace-scoped. Existing configured Sales
-- workspaces remain enabled; unconfigured and newly-created workspaces stay gated.
BEGIN;

UPDATE public.field_sales_settings
SET enabled=false
WHERE currency IS NULL OR timezone IS NULL;

CREATE OR REPLACE FUNCTION public.field_sales_initialize_workspace() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO public.field_sales_settings(workspace_id,enabled,timezone)
 VALUES(NEW.id,false,CASE WHEN EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=NEW.timezone) THEN NEW.timezone END)
 ON CONFLICT(workspace_id) DO NOTHING;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.field_sales_initialize_workspace() FROM PUBLIC,anon,authenticated;

COMMIT;
