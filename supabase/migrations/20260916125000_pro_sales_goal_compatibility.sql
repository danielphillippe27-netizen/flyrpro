BEGIN;
-- Preserve existing targets without inventing who originally created them.
ALTER TABLE public.field_sales_targets ADD COLUMN legacy_goal_id uuid UNIQUE;
ALTER TABLE public.field_sales_targets ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.field_sales_target_events ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE public.field_sales_target_events DROP CONSTRAINT field_sales_target_events_action_check;
ALTER TABLE public.field_sales_target_events ADD CHECK(action IN ('created','updated','archived','restored','migrated'));
INSERT INTO public.field_sales_targets(id,workspace_id,scope,scope_id,metric,target,starts_on,ends_on,title,created_by,request_id,request_payload,legacy_goal_id)
SELECT g.id,g.workspace_id,CASE WHEN g.rep_id IS NULL THEN 'workspace' ELSE 'rep' END,g.rep_id,'sales',g.target,g.month,(g.month+interval '1 month - 1 day')::date,
 'Monthly sales target',NULL,g.id,jsonb_build_object('origin','legacy_monthly_goal','legacy_id',g.id),g.id FROM public.field_sales_goals g;
INSERT INTO public.field_sales_target_events(workspace_id,target_id,actor_id,action,after_record)
SELECT workspace_id,id,NULL,'migrated',to_jsonb(g)-'request_payload' FROM public.field_sales_targets g WHERE legacy_goal_id IS NOT NULL;

CREATE FUNCTION public.field_sales_legacy_goal_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE old_target public.field_sales_targets; updated public.field_sales_targets; row_data public.field_sales_goals; goal_scope text;
BEGIN
 IF pg_trigger_depth()>1 THEN RETURN NULL; END IF;
 row_data:=CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 goal_scope:=CASE WHEN row_data.rep_id IS NULL THEN 'workspace' ELSE 'rep' END;
 SELECT * INTO old_target FROM public.field_sales_targets WHERE workspace_id=row_data.workspace_id AND scope=goal_scope
  AND scope_id IS NOT DISTINCT FROM row_data.rep_id AND metric='sales' AND starts_on=row_data.month
  AND ends_on=(row_data.month+interval '1 month - 1 day')::date
  ORDER BY archived,updated_at DESC,id LIMIT 1 FOR UPDATE;
 IF TG_OP='DELETE' THEN
  IF old_target.id IS NULL OR old_target.archived THEN RETURN NULL; END IF;
  UPDATE public.field_sales_targets SET archived=true,version=version+1,updated_at=now() WHERE id=old_target.id RETURNING * INTO updated;
 ELSIF old_target.id IS NULL THEN
  INSERT INTO public.field_sales_targets(workspace_id,scope,scope_id,metric,target,starts_on,ends_on,title,created_by,request_id,request_payload,legacy_goal_id)
  VALUES(row_data.workspace_id,goal_scope,row_data.rep_id,'sales',row_data.target,row_data.month,(row_data.month+interval '1 month - 1 day')::date,
   'Monthly sales target',auth.uid(),gen_random_uuid(),jsonb_build_object('origin','legacy_monthly_goal','legacy_id',row_data.id),row_data.id) RETURNING * INTO updated;
 ELSE
  UPDATE public.field_sales_targets SET target=row_data.target,archived=false,legacy_goal_id=row_data.id,version=version+1,updated_at=now() WHERE id=old_target.id RETURNING * INTO updated;
 END IF;
 INSERT INTO public.field_sales_target_events(workspace_id,target_id,actor_id,action,before_record,after_record)
 VALUES(updated.workspace_id,updated.id,auth.uid(),CASE WHEN TG_OP='DELETE' THEN 'archived' WHEN old_target.id IS NULL THEN 'created' ELSE 'updated' END,
  CASE WHEN old_target.id IS NOT NULL THEN to_jsonb(old_target)-'request_payload' END,to_jsonb(updated)-'request_payload');
 RETURN NULL;
END $$;
CREATE TRIGGER field_sales_legacy_goal_sync AFTER INSERT OR UPDATE OR DELETE ON public.field_sales_goals FOR EACH ROW EXECUTE FUNCTION public.field_sales_legacy_goal_sync();

CREATE FUNCTION public.field_sales_target_legacy_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF pg_trigger_depth()>1 THEN RETURN NULL; END IF;
 -- Remove the old representation when a modern target changes period or is archived.
 IF TG_OP='UPDATE' AND OLD.scope IN ('rep','workspace') AND OLD.metric='sales' AND extract(day FROM OLD.starts_on)=1
  AND OLD.ends_on=(OLD.starts_on+interval '1 month - 1 day')::date THEN
  DELETE FROM public.field_sales_goals WHERE workspace_id=OLD.workspace_id AND rep_id IS NOT DISTINCT FROM OLD.scope_id AND month=OLD.starts_on;
 END IF;
 IF NOT NEW.archived AND NEW.scope IN ('rep','workspace') AND NEW.metric='sales' AND NEW.target<=1000000
  AND extract(day FROM NEW.starts_on)=1 AND NEW.ends_on=(NEW.starts_on+interval '1 month - 1 day')::date THEN
  DELETE FROM public.field_sales_goals WHERE workspace_id=NEW.workspace_id AND rep_id IS NOT DISTINCT FROM NEW.scope_id AND month=NEW.starts_on;
  INSERT INTO public.field_sales_goals(id,workspace_id,rep_id,month,target) VALUES(coalesce(NEW.legacy_goal_id,NEW.id),NEW.workspace_id,NEW.scope_id,NEW.starts_on,NEW.target::integer);
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER field_sales_target_legacy_sync AFTER INSERT OR UPDATE ON public.field_sales_targets FOR EACH ROW EXECUTE FUNCTION public.field_sales_target_legacy_sync();
REVOKE ALL ON FUNCTION public.field_sales_legacy_goal_sync(),public.field_sales_target_legacy_sync() FROM PUBLIC,anon,authenticated;
COMMIT;
