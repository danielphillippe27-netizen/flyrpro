BEGIN;
CREATE FUNCTION public.field_sales_entry(p_workspace uuid,p_context jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r text:=public.field_sales_role(p_workspace); cfg public.field_sales_settings; f jsonb:=coalesce(p_context,'{}');
 lead_record public.contacts; contact uuid:=nullif(f->>'contact_id','')::uuid; a public.contact_activities; op public.field_sales_opportunities;
 manager boolean; attribute boolean; needle text:=lower(trim(coalesce(f->>'search','')));opts jsonb;members jsonb;appointments jsonb;duplicates jsonb;selected jsonb;property text;count_rows integer;
BEGIN
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=p_workspace;
 IF NOT coalesce(cfg.enabled,false) THEN RETURN jsonb_build_object('enabled',false); END IF;
 IF cfg.currency IS NULL OR cfg.timezone IS NULL THEN RETURN public.field_sales_bootstrap(p_workspace)||jsonb_build_object('needs_setup',true); END IF;
 IF NOT public.field_sales_permission(p_workspace,'submit') THEN RAISE EXCEPTION 'Sale submission permission required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(f) IS DISTINCT FROM 'object' OR length(needle)>200 THEN RAISE EXCEPTION 'Invalid sale entry context'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(f) k WHERE k NOT IN ('contact_id','appointment_id','opportunity_id','property_key','campaign_id','search')) THEN RAISE EXCEPTION 'Unknown sale entry context'; END IF;
 manager:=public.field_sales_permission(p_workspace,'team_details');attribute:=public.field_sales_permission(p_workspace,'attribution');
 IF nullif(f->>'appointment_id','') IS NOT NULL THEN
  SELECT ca.* INTO a FROM public.contact_activities ca JOIN public.contacts c ON c.id=ca.contact_id
   WHERE ca.id=(f->>'appointment_id')::uuid AND c.workspace_id=p_workspace AND (manager OR c.user_id=auth.uid()) AND ca.type='meeting' AND ca.timestamp<=now() AND coalesce(to_jsonb(ca)->>'status','') NOT IN ('cancelled','canceled');
  IF NOT FOUND OR (contact IS NOT NULL AND contact<>a.contact_id) THEN RAISE EXCEPTION 'Select an accessible past appointment' USING ERRCODE='42501'; END IF;
  contact:=a.contact_id;
 END IF;
 IF nullif(f->>'opportunity_id','') IS NOT NULL THEN
  SELECT o.* INTO op FROM public.field_sales_opportunities o JOIN public.contacts c ON c.id=o.contact_id
   WHERE o.id=(f->>'opportunity_id')::uuid AND o.workspace_id=p_workspace AND c.workspace_id=p_workspace AND (manager OR c.user_id=auth.uid());
  IF NOT FOUND OR (contact IS NOT NULL AND contact<>op.contact_id) THEN RAISE EXCEPTION 'Select an accessible opportunity' USING ERRCODE='42501'; END IF;
  contact:=op.contact_id;
 END IF;
 IF nullif(f->>'campaign_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.campaigns WHERE workspace_id=p_workspace AND id=(f->>'campaign_id')::uuid) THEN RAISE EXCEPTION 'Campaign unavailable'; END IF;
 IF contact IS NOT NULL THEN
  SELECT * INTO lead_record FROM public.contacts WHERE id=contact AND workspace_id=p_workspace AND (manager OR user_id=auth.uid());
  IF NOT FOUND THEN RAISE EXCEPTION 'Select an accessible workspace lead' USING ERRCODE='42501'; END IF;
  property:=coalesce(nullif(to_jsonb(lead_record)->>'building_id',''),nullif(to_jsonb(lead_record)->>'address_id',''),nullif(lower(trim(to_jsonb(lead_record)->>'address')),''));
  IF nullif(f->>'property_key','') IS NOT NULL AND property IS DISTINCT FROM f->>'property_key' THEN RAISE EXCEPTION 'Lead does not belong to this property'; END IF;
  IF nullif(f->>'campaign_id','') IS NOT NULL AND lead_record.campaign_id IS DISTINCT FROM (f->>'campaign_id')::uuid THEN RAISE EXCEPTION 'Lead does not belong to this campaign'; END IF;
  SELECT * INTO op FROM public.field_sales_opportunities WHERE workspace_id=p_workspace AND contact_id=contact;
  selected:=jsonb_build_object('id',lead_record.id,'name',coalesce(lead_record.full_name,'Prospect'),'address',to_jsonb(lead_record)->>'address','rep_id',lead_record.user_id,'setter_id',lead_record.user_id,'closer_id',lead_record.user_id,'campaign_id',lead_record.campaign_id,'opportunity_id',op.id,'appointment_id',a.id);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'scheduled_at',timestamp) ORDER BY timestamp DESC),'[]') INTO appointments FROM public.contact_activities
   WHERE contact_id=lead_record.id AND type='meeting' AND timestamp<=now() AND coalesce(to_jsonb(contact_activities)->>'status','') NOT IN ('cancelled','canceled');
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'sold_on',sold_on,'product',product) ORDER BY sold_on DESC),'[]') INTO duplicates
   FROM public.field_sales WHERE workspace_id=p_workspace AND status IN ('pending','verified') AND (contact_id=lead_record.id OR (property IS NOT NULL AND property_key=property));
 END IF;
 WITH matches AS (SELECT c.id,c.full_name,to_jsonb(c)->>'address' address,c.campaign_id FROM public.contacts c
  WHERE c.workspace_id=p_workspace AND (manager OR c.user_id=auth.uid())
  AND (nullif(f->>'campaign_id','') IS NULL OR c.campaign_id=(f->>'campaign_id')::uuid)
  AND (nullif(f->>'property_key','') IS NULL OR coalesce(nullif(to_jsonb(c)->>'building_id',''),nullif(to_jsonb(c)->>'address_id',''),nullif(lower(trim(to_jsonb(c)->>'address')),''))=f->>'property_key')
  AND (needle='' OR strpos(lower(coalesce(c.full_name,'')||' '||coalesce(to_jsonb(c)->>'address','')||' '||coalesce(to_jsonb(c)->>'phone','')||' '||coalesce(to_jsonb(c)->>'email','')),needle)>0)
  ORDER BY c.full_name,c.id LIMIT 51)
 SELECT count(*),(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',coalesce(full_name,'Prospect'),'address',address,'campaign_id',campaign_id) ORDER BY full_name,id),'[]') FROM (SELECT * FROM matches LIMIT 50) page) INTO count_rows,opts FROM matches;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',wm.user_id,'name',coalesce(u.raw_user_meta_data->>'full_name','Representative')) ORDER BY wm.user_id),'[]') INTO members
 FROM public.workspace_members wm JOIN auth.users u ON u.id=wm.user_id WHERE wm.workspace_id=p_workspace AND (attribute OR wm.user_id=auth.uid());
 RETURN public.field_sales_bootstrap(p_workspace)||jsonb_build_object('entry_version',1,'today',(now() AT TIME ZONE cfg.timezone)::date,'contacts',opts,'has_more_contacts',count_rows>50,'selected',selected,
  'representatives',members,'appointments',coalesce(appointments,'[]'),'duplicates',coalesce(duplicates,'[]'),'can_assign',attribute,'can_override_duplicate',attribute);
END $$;
REVOKE ALL ON FUNCTION public.field_sales_entry(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.field_sales_entry(uuid,jsonb) TO authenticated;
COMMIT;
