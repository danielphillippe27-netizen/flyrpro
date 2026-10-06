BEGIN;
ALTER TABLE public.contacts ADD COLUMN do_not_contact boolean NOT NULL DEFAULT false;
CREATE TABLE public.field_conversation_contact_preferences (
 conversation_id uuid PRIMARY KEY REFERENCES public.field_conversations(id),
 request_id uuid NOT NULL UNIQUE,
 user_id uuid NOT NULL REFERENCES auth.users(id),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 contact_id uuid NOT NULL REFERENCES public.contacts(id),
 payload jsonb NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.field_conversation_contact_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.field_conversation_contact_preferences FROM anon,authenticated;
CREATE FUNCTION public.review_field_contact_preference(p_recording uuid,p_conversation uuid,p_user uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.field_recordings; c public.field_conversations; lead public.contacts;
 previous public.field_conversation_contact_preferences; citation jsonb; proposal jsonb;
 contact uuid; selected_address uuid; request uuid; idx integer; result jsonb;
BEGIN
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('requestId','version','contactId','addressId','proposalIndex','confirmed')) THEN RAISE EXCEPTION 'Invalid preference request' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM public.field_recordings WHERE id=p_recording AND user_id=p_user AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=r.workspace_id AND user_id=p_user) THEN RAISE EXCEPTION 'Recording unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.field_conversations WHERE id=p_conversation AND recording_id=r.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conversation unavailable' USING ERRCODE='P0002'; END IF;
 SELECT * INTO previous FROM public.field_conversation_contact_preferences WHERE conversation_id=c.id;
 IF FOUND THEN
  IF previous.user_id=p_user AND previous.payload=p_payload THEN RETURN previous.result; END IF;
  RAISE EXCEPTION 'Preference already reviewed with different selections' USING ERRCODE='40001';
 END IF;
 IF c.version IS DISTINCT FROM (p_payload->>'version')::integer OR c.review_state NOT IN ('pending','approved') THEN RAISE EXCEPTION 'Conversation changed' USING ERRCODE='40001'; END IF;
 IF c.consent<>'granted' OR NOT c.target_confirmed OR c.target_id IS NULL OR p_payload->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Confirm assignment, permission and contact preference first' USING ERRCODE='22023'; END IF;
 request:=(p_payload->>'requestId')::uuid; contact:=(p_payload->>'contactId')::uuid; selected_address:=(p_payload->>'addressId')::uuid; idx:=(p_payload->>'proposalIndex')::integer;
 IF request IS NULL OR contact IS NULL OR selected_address IS NULL OR idx IS NULL OR idx<0 OR idx>=jsonb_array_length(c.action_proposals) THEN RAISE EXCEPTION 'Invalid preference selection' USING ERRCODE='22023'; END IF;
 SELECT * INTO lead FROM public.contacts WHERE id=contact AND user_id=p_user AND workspace_id=r.workspace_id FOR UPDATE;
 IF NOT FOUND OR coalesce(to_jsonb(lead)->>'lead_kind','field')<>'field' THEN RAISE EXCEPTION 'Select your own workspace field contact' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.campaign_addresses ca JOIN public.sessions s ON s.campaign_id=ca.campaign_id JOIN public.campaigns campaign ON campaign.id=ca.campaign_id
  WHERE s.id=r.session_id AND s.workspace_id=r.workspace_id AND campaign.workspace_id=r.workspace_id AND ca.id=selected_address
  AND (ca.id=c.target_id OR lower(ca.gers_id::text)=c.target_id::text)) OR coalesce(to_jsonb(lead)->>'address_id',to_jsonb(lead)->>'campaign_address_id','')<>selected_address::text THEN RAISE EXCEPTION 'Contact must match this confirmed household' USING ERRCODE='22023'; END IF;
 proposal:=c.action_proposals->idx;
 IF proposal->>'kind' IS DISTINCT FROM 'do_not_contact' OR jsonb_typeof(proposal->'evidence') IS DISTINCT FROM 'array' OR jsonb_array_length(proposal->'evidence')=0 THEN RAISE EXCEPTION 'Select an evidence-backed no-contact request' USING ERRCODE='22023'; END IF;
 FOR citation IN SELECT value FROM jsonb_array_elements(proposal->'evidence') LOOP
  IF nullif(trim(citation->>'quote'),'') IS NULL OR length(citation->>'quote')>2000 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.segments) segment WHERE segment->>'id'=citation->>'segmentId' AND position(citation->>'quote' IN segment->>'text')>0) THEN RAISE EXCEPTION 'Preference evidence must cite this transcript' USING ERRCODE='22023'; END IF;
 END LOOP;
 UPDATE public.contacts SET do_not_contact=true WHERE id=contact;
 UPDATE public.field_conversations SET version=version+1 WHERE id=c.id RETURNING * INTO c;
 result:=jsonb_build_object('conversationId',c.id,'version',c.version,'contactId',contact,'doNotContact',true,'requestId',request);
 INSERT INTO public.field_conversation_contact_preferences(conversation_id,request_id,user_id,workspace_id,contact_id,payload,result) VALUES(c.id,request,p_user,r.workspace_id,contact,p_payload,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.review_field_contact_preference(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.review_field_contact_preference(uuid,uuid,uuid,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.apply_field_conversation(p_recording uuid,p_conversation uuid,p_user uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.field_recordings; c public.field_conversations; lead public.contacts;
 previous public.field_conversation_applications; selected jsonb; proposal jsonb; citation jsonb;
 selected_address uuid; contact uuid; request uuid; activity uuid; task uuid; tasks jsonb:='[]'; meetings jsonb:='[]';
 due timestamptz; idx integer; indices integer[]:='{}'; result jsonb;
BEGIN
 SELECT * INTO r FROM public.field_recordings WHERE id=p_recording AND user_id=p_user AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=r.workspace_id AND user_id=p_user) THEN
  RAISE EXCEPTION 'Recording unavailable' USING ERRCODE='42501';
 END IF;
 SELECT * INTO c FROM public.field_conversations WHERE id=p_conversation AND recording_id=r.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conversation unavailable' USING ERRCODE='P0002'; END IF;
 SELECT * INTO previous FROM public.field_conversation_applications WHERE conversation_id=c.id;
 IF FOUND THEN
  IF previous.user_id=p_user AND previous.payload=p_payload THEN RETURN previous.result; END IF;
  RAISE EXCEPTION 'Conversation already applied with different selections' USING ERRCODE='40001';
 END IF;
 IF c.version IS DISTINCT FROM (p_payload->>'version')::integer OR c.review_state<>'pending' THEN RAISE EXCEPTION 'Conversation changed' USING ERRCODE='40001'; END IF;
 IF c.consent<>'granted' OR NOT c.target_confirmed OR c.target_id IS NULL THEN RAISE EXCEPTION 'Confirm door assignment and recording permission first' USING ERRCODE='22023'; END IF;
 request:=(p_payload->>'requestId')::uuid; contact:=(p_payload->>'contactId')::uuid; selected_address:=(p_payload->>'addressId')::uuid;
 IF request IS NULL OR contact IS NULL OR selected_address IS NULL OR jsonb_typeof(p_payload->'actions') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'actions')>20 THEN RAISE EXCEPTION 'Invalid approval selections' USING ERRCODE='22023'; END IF;
 SELECT * INTO lead FROM public.contacts WHERE id=contact AND user_id=p_user AND workspace_id=r.workspace_id FOR UPDATE;
 IF NOT FOUND OR coalesce(to_jsonb(lead)->>'lead_kind','field')<>'field' THEN RAISE EXCEPTION 'Select your own workspace field contact' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.campaign_addresses ca JOIN public.sessions s ON s.campaign_id=ca.campaign_id JOIN public.campaigns campaign ON campaign.id=ca.campaign_id
  WHERE s.id=r.session_id AND s.workspace_id=r.workspace_id AND campaign.workspace_id=r.workspace_id AND ca.id=selected_address
  AND (ca.id=c.target_id OR lower(ca.gers_id::text)=c.target_id::text))
  OR coalesce(to_jsonb(lead)->>'address_id',to_jsonb(lead)->>'campaign_address_id','')<>selected_address::text THEN
  RAISE EXCEPTION 'Contact must be linked to the selected household at this session target' USING ERRCODE='22023';
 END IF;
 IF lead.do_not_contact AND jsonb_array_length(p_payload->'actions')>0 THEN RAISE EXCEPTION 'Contact has requested no further contact' USING ERRCODE='22023'; END IF;
 IF coalesce((p_payload->>'saveNote')::boolean,false) THEN
  IF nullif(trim(c.note),'') IS NULL OR jsonb_typeof(c.evidence) IS DISTINCT FROM 'array' OR jsonb_array_length(c.evidence)=0 THEN RAISE EXCEPTION 'An evidence-backed note is required' USING ERRCODE='22023'; END IF;
  FOR citation IN SELECT value FROM jsonb_array_elements(c.evidence) LOOP
   IF nullif(citation->>'quote','') IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.segments) segment WHERE segment->>'id'=citation->>'segmentId' AND position(citation->>'quote' IN segment->>'text')>0) THEN
    RAISE EXCEPTION 'Note evidence must cite this transcript' USING ERRCODE='22023';
   END IF;
  END LOOP;
  activity:=gen_random_uuid();
  INSERT INTO public.contact_activities(id,contact_id,type,note,timestamp) VALUES(activity,contact,'note',c.note,now());
 END IF;
 FOR selected IN SELECT value FROM jsonb_array_elements(p_payload->'actions') LOOP
  idx:=(selected->>'proposalIndex')::integer;
  IF idx IS NULL OR idx<0 OR idx>=jsonb_array_length(c.action_proposals) OR idx=ANY(indices) THEN RAISE EXCEPTION 'Invalid or repeated action selection' USING ERRCODE='22023'; END IF;
  indices:=array_append(indices,idx); proposal:=c.action_proposals->idx;
  IF proposal->>'kind' NOT IN ('call','text','email','visit','send_cma','appointment') THEN RAISE EXCEPTION 'This action requires separate contact preference review' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(proposal->'evidence') IS DISTINCT FROM 'array' OR jsonb_array_length(proposal->'evidence')=0 THEN RAISE EXCEPTION 'Action evidence required' USING ERRCODE='22023'; END IF;
  FOR citation IN SELECT value FROM jsonb_array_elements(proposal->'evidence') LOOP
   IF nullif(citation->>'quote','') IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.segments) segment WHERE segment->>'id'=citation->>'segmentId' AND position(citation->>'quote' IN segment->>'text')>0) THEN
    RAISE EXCEPTION 'Action evidence must cite this transcript' USING ERRCODE='22023';
   END IF;
  END LOOP;
  due:=nullif(selected->>'dueAt','')::timestamptz;
  IF due IS NULL THEN RAISE EXCEPTION 'Choose a date and time for each selected action' USING ERRCODE='22023'; END IF;
  IF proposal->>'kind'='appointment' THEN
   task:=gen_random_uuid();
   INSERT INTO public.contact_activities(id,contact_id,type,note,timestamp) VALUES(task,contact,'meeting',proposal->>'title',due);
   meetings:=meetings||jsonb_build_array(task);
  ELSE
   IF NOT EXISTS(SELECT 1 FROM public.field_sales_settings WHERE workspace_id=r.workspace_id AND enabled AND currency IS NOT NULL AND timezone IS NOT NULL) THEN
    RAISE EXCEPTION 'Set up Sales before creating follow-up tasks' USING ERRCODE='22023';
   END IF;
   task:=gen_random_uuid();
   INSERT INTO public.field_sales_tasks(id,workspace_id,contact_id,user_id,title,kind,due_at)
   VALUES(task,r.workspace_id,contact,p_user,proposal->>'title',CASE WHEN proposal->>'kind'='send_cma' THEN 'task' ELSE proposal->>'kind' END,due);
   INSERT INTO public.field_sales_pipeline_events(workspace_id,contact_id,actor_id,action,detail)
   VALUES(r.workspace_id,contact,p_user,'conversation_task',jsonb_build_object('taskId',task,'conversationId',c.id,'proposalIndex',idx));
   tasks:=tasks||jsonb_build_array(task);
  END IF;
 END LOOP;
 IF activity IS NULL AND jsonb_array_length(tasks)=0 AND jsonb_array_length(meetings)=0 THEN RAISE EXCEPTION 'Select a note or action to apply' USING ERRCODE='22023'; END IF;
 UPDATE public.field_conversations SET review_state='approved',reviewed_at=now(),version=version+1 WHERE id=c.id RETURNING * INTO c;
 result:=jsonb_build_object('conversation',to_jsonb(c),'contactId',contact,'noteActivityId',activity,'taskIds',tasks,'appointmentIds',meetings);
 INSERT INTO public.field_conversation_applications(conversation_id,request_id,user_id,payload,result) VALUES(c.id,request,p_user,p_payload,result);
 RETURN result;
END $$;
CREATE FUNCTION public.guard_field_task_contact_preference()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE blocked boolean;
BEGIN
 IF NEW.kind IN ('call','email','text','visit') THEN
  SELECT c.do_not_contact INTO blocked FROM public.contacts c WHERE c.id=NEW.contact_id FOR UPDATE;
  IF blocked THEN RAISE EXCEPTION 'Contact has requested no further contact' USING ERRCODE='22023'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_field_task_contact_preference() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER field_task_contact_preference BEFORE INSERT OR UPDATE OF contact_id,kind ON public.field_sales_tasks FOR EACH ROW EXECUTE FUNCTION public.guard_field_task_contact_preference();
CREATE OR REPLACE FUNCTION public.field_conversation_application_options(p_recording uuid,p_conversation uuid,p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.field_recordings; c public.field_conversations; households jsonb; tasks_enabled boolean;
BEGIN
 SELECT * INTO r FROM public.field_recordings WHERE id=p_recording AND user_id=p_user AND deleted_at IS NULL;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=r.workspace_id AND user_id=p_user) THEN RAISE EXCEPTION 'Recording unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.field_conversations WHERE id=p_conversation AND recording_id=r.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conversation unavailable' USING ERRCODE='P0002'; END IF;
 IF c.consent<>'granted' OR NOT c.target_confirmed OR c.review_state NOT IN ('pending','approved') THEN RAISE EXCEPTION 'Confirm door assignment and recording permission first' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('addressId',ca.id,
  'label',coalesce(nullif(trim(to_jsonb(ca)->>'address'),''),nullif(trim(to_jsonb(ca)->>'formatted'),''),'Unresolved address '||ca.id::text),
  'contacts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',lead.id,'name',coalesce(nullif(trim(to_jsonb(lead)->>'full_name'),''),'Unnamed contact')) ORDER BY lead.id)
   FROM public.contacts lead WHERE lead.workspace_id=r.workspace_id AND lead.user_id=p_user AND coalesce(to_jsonb(lead)->>'lead_kind','field')='field'
   AND coalesce(to_jsonb(lead)->>'address_id',to_jsonb(lead)->>'campaign_address_id','')=ca.id::text),'[]')) ORDER BY ca.id),'[]') INTO households
 FROM public.campaign_addresses ca JOIN public.sessions s ON s.campaign_id=ca.campaign_id JOIN public.campaigns campaign ON campaign.id=ca.campaign_id
 WHERE s.id=r.session_id AND s.workspace_id=r.workspace_id AND campaign.workspace_id=r.workspace_id
 AND (ca.id=c.target_id OR lower(ca.gers_id::text)=c.target_id::text);
 SELECT EXISTS(SELECT 1 FROM public.field_sales_settings WHERE workspace_id=r.workspace_id AND enabled AND currency IS NOT NULL AND timezone IS NOT NULL) INTO tasks_enabled;
 RETURN jsonb_build_object('households',households,'taskCreationEnabled',tasks_enabled);
END $$;
COMMIT;
