-- Apply after authenticated web and iOS acceptance. Reporting settings still require owner confirmation.
BEGIN;
-- Empty workspace cleanup must remain possible; ledger records retain their own protections.
ALTER TABLE public.field_sales_settings DROP CONSTRAINT field_sales_settings_workspace_id_fkey,
 ADD CONSTRAINT field_sales_settings_workspace_id_fkey FOREIGN KEY(workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.field_sales_stages DROP CONSTRAINT field_sales_stages_workspace_id_fkey,
 ADD CONSTRAINT field_sales_stages_workspace_id_fkey FOREIGN KEY(workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.field_sales_goals DROP CONSTRAINT field_sales_goals_workspace_id_fkey,
 ADD CONSTRAINT field_sales_goals_workspace_id_fkey FOREIGN KEY(workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
INSERT INTO public.field_sales_settings(workspace_id,enabled,timezone)
 SELECT w.id,true,CASE WHEN EXISTS(SELECT 1 FROM pg_timezone_names t WHERE t.name=w.timezone) THEN w.timezone END
 FROM public.workspaces w ON CONFLICT(workspace_id) DO NOTHING;
-- New workspaces receive the same Beta entry point; client users cannot modify the enable flag.
CREATE FUNCTION public.field_sales_initialize_workspace() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO public.field_sales_settings(workspace_id,enabled,timezone)
 VALUES(NEW.id,true,CASE WHEN EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=NEW.timezone) THEN NEW.timezone END)
 ON CONFLICT(workspace_id) DO NOTHING;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.field_sales_initialize_workspace() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER field_sales_workspace_created AFTER INSERT ON public.workspaces
 FOR EACH ROW EXECUTE FUNCTION public.field_sales_initialize_workspace();
COMMIT;
