-- Sales V1 is appointment-led: every new sale must be converted from a completed/past appointment.
-- Historical unlinked sales remain readable; the gate applies to new submissions and source changes.
BEGIN;

CREATE FUNCTION public.field_sales_require_appointment_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE source_contact public.contacts; source_appointment public.contact_activities;
BEGIN
 IF TG_OP='UPDATE' AND OLD.appointment_id IS NULL AND NEW.appointment_id IS NULL THEN
  RETURN NEW;
 END IF;
 SELECT * INTO source_appointment FROM public.contact_activities
  WHERE id=NEW.appointment_id AND type='meeting' AND timestamp<=now()
  AND coalesce(to_jsonb(contact_activities)->>'status','') NOT IN ('cancelled','canceled');
 IF NOT FOUND THEN RAISE EXCEPTION 'Select a completed or past appointment before recording a sale'; END IF;
 SELECT * INTO source_contact FROM public.contacts
  WHERE id=source_appointment.contact_id AND workspace_id=NEW.workspace_id;
 IF NOT FOUND OR source_contact.id IS DISTINCT FROM NEW.contact_id THEN
  RAISE EXCEPTION 'The appointment must belong to the sale customer and workspace';
 END IF;
 IF NEW.rep_id IS DISTINCT FROM source_contact.user_id THEN
  RAISE EXCEPTION 'The sale must be credited to the representative who owns the appointment';
 END IF;
 IF EXISTS(SELECT 1 FROM public.field_sales s WHERE s.workspace_id=NEW.workspace_id
  AND s.appointment_id=NEW.appointment_id AND s.id IS DISTINCT FROM NEW.id
  AND s.status IN ('pending','verified')) THEN
  RAISE EXCEPTION 'This appointment has already been converted to a sale' USING ERRCODE='23505';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.field_sales_require_appointment_source() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS field_sales_require_appointment_source ON public.field_sales;
CREATE TRIGGER field_sales_require_appointment_source
 BEFORE INSERT OR UPDATE OF appointment_id,contact_id,rep_id ON public.field_sales
 FOR EACH ROW EXECUTE FUNCTION public.field_sales_require_appointment_source();

CREATE OR REPLACE FUNCTION public.field_sales_entry(p_workspace uuid,p_context jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r text:=public.field_sales_role(p_workspace); cfg public.field_sales_settings; f jsonb:=coalesce(p_context,'{}');
 lead_record public.contacts; contact uuid:=nullif(f->>'contact_id','')::uuid; a public.contact_activities;
 manager boolean; attribute boolean; needle text:=lower(trim(coalesce(f->>'search','')));
 choices jsonb; members jsonb; appointments jsonb; duplicates jsonb; selected jsonb; property text; count_rows integer;
BEGIN
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=p_workspace;
 IF NOT coalesce(cfg.enabled,false) THEN RETURN jsonb_build_object('enabled',false); END IF;
 IF cfg.currency IS NULL OR cfg.timezone IS NULL THEN RETURN public.field_sales_bootstrap(p_workspace)||jsonb_build_object('needs_setup',true); END IF;
 IF NOT public.field_sales_permission(p_workspace,'submit') THEN RAISE EXCEPTION 'Sale submission permission required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(f) IS DISTINCT FROM 'object' OR length(needle)>200 THEN RAISE EXCEPTION 'Invalid sale entry context'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(f) k WHERE k NOT IN ('contact_id','appointment_id','search')) THEN RAISE EXCEPTION 'Sales must start from an appointment'; END IF;
 manager:=public.field_sales_permission(p_workspace,'team_details'); attribute:=public.field_sales_permission(p_workspace,'attribution');

 IF nullif(f->>'appointment_id','') IS NOT NULL THEN
  SELECT ca.* INTO a FROM public.contact_activities ca JOIN public.contacts c ON c.id=ca.contact_id
   WHERE ca.id=(f->>'appointment_id')::uuid AND c.workspace_id=p_workspace
   AND (manager OR c.user_id=auth.uid()) AND ca.type='meeting' AND ca.timestamp<=now()
   AND coalesce(to_jsonb(ca)->>'status','') NOT IN ('cancelled','canceled')
   AND NOT EXISTS(SELECT 1 FROM public.field_sales s WHERE s.workspace_id=p_workspace
    AND s.appointment_id=ca.id AND s.status IN ('pending','verified'));
  IF NOT FOUND OR (contact IS NOT NULL AND contact<>a.contact_id) THEN
   RAISE EXCEPTION 'Select an eligible past appointment' USING ERRCODE='42501';
  END IF;
  contact:=a.contact_id;
 ELSIF contact IS NOT NULL THEN
  RAISE EXCEPTION 'Select an appointment before recording a sale';
 END IF;

 IF contact IS NOT NULL THEN
  SELECT * INTO lead_record FROM public.contacts WHERE id=contact AND workspace_id=p_workspace
   AND (manager OR user_id=auth.uid());
  IF NOT FOUND THEN RAISE EXCEPTION 'Select an accessible workspace appointment' USING ERRCODE='42501'; END IF;
  property:=coalesce(nullif(to_jsonb(lead_record)->>'building_id',''),nullif(to_jsonb(lead_record)->>'address_id',''),nullif(lower(trim(to_jsonb(lead_record)->>'address')),''));
  selected:=jsonb_build_object('id',lead_record.id,'name',coalesce(lead_record.full_name,'Prospect'),
   'address',to_jsonb(lead_record)->>'address','rep_id',lead_record.user_id,'setter_id',lead_record.user_id,
   'closer_id',lead_record.user_id,'campaign_id',lead_record.campaign_id,'appointment_id',a.id,
   'appointment_at',a.timestamp);
  appointments:=jsonb_build_array(jsonb_build_object('id',a.id,'scheduled_at',a.timestamp));
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'sold_on',sold_on,'product',product) ORDER BY sold_on DESC),'[]') INTO duplicates
   FROM public.field_sales WHERE workspace_id=p_workspace AND status IN ('pending','verified')
   AND (contact_id=lead_record.id OR (property IS NOT NULL AND property_key=property));
 END IF;

 WITH matches AS (
  SELECT ca.id,ca.contact_id,ca.timestamp,c.full_name,to_jsonb(c)->>'address' address
  FROM public.contact_activities ca JOIN public.contacts c ON c.id=ca.contact_id
  WHERE c.workspace_id=p_workspace AND (manager OR c.user_id=auth.uid()) AND ca.type='meeting' AND ca.timestamp<=now()
  AND coalesce(to_jsonb(ca)->>'status','') NOT IN ('cancelled','canceled')
  AND NOT EXISTS(SELECT 1 FROM public.field_sales s WHERE s.workspace_id=p_workspace
   AND s.appointment_id=ca.id AND s.status IN ('pending','verified'))
  AND (needle='' OR strpos(lower(coalesce(c.full_name,'')||' '||coalesce(to_jsonb(c)->>'address','')),needle)>0)
  ORDER BY ca.timestamp DESC,ca.id LIMIT 51
 )
 SELECT count(*),(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'contact_id',contact_id,
  'name',coalesce(full_name,'Prospect'),'address',address,'scheduled_at',timestamp)
  ORDER BY timestamp DESC,id),'[]') FROM (SELECT * FROM matches LIMIT 50) page)
 INTO count_rows,choices FROM matches;

 SELECT coalesce(jsonb_agg(jsonb_build_object('id',wm.user_id,'name',coalesce(u.raw_user_meta_data->>'full_name','Representative')) ORDER BY wm.user_id),'[]') INTO members
 FROM public.workspace_members wm JOIN auth.users u ON u.id=wm.user_id
 WHERE wm.workspace_id=p_workspace AND (attribute OR wm.user_id=auth.uid());
 RETURN public.field_sales_bootstrap(p_workspace)||jsonb_build_object('entry_version',2,
  'today',(now() AT TIME ZONE cfg.timezone)::date,'appointment_options',coalesce(choices,'[]'),
  'has_more_appointments',count_rows>50,'contacts','[]'::jsonb,'has_more_contacts',false,
  'selected',selected,'representatives',members,'appointments',coalesce(appointments,'[]'),
  'duplicates',coalesce(duplicates,'[]'),'can_assign',false,'can_override_duplicate',attribute);
END $$;
REVOKE ALL ON FUNCTION public.field_sales_entry(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.field_sales_entry(uuid,jsonb) TO authenticated;

COMMIT;
