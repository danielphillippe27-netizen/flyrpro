BEGIN;
ALTER TABLE public.field_conversations DROP CONSTRAINT field_conversations_review_state_check;
ALTER TABLE public.field_conversations ADD CONSTRAINT field_conversations_review_state_check CHECK(review_state IN ('pending','approved','rejected','superseded'));
ALTER TABLE public.field_conversations ADD COLUMN parent_conversation_ids uuid[] NOT NULL DEFAULT '{}';
DROP INDEX public.field_conversations_chunk_start;
CREATE UNIQUE INDEX field_conversations_chunk_start ON public.field_conversations(chunk_id,((segments->0->>'id'))) WHERE chunk_id IS NOT NULL AND review_state<>'superseded';
CREATE TABLE public.field_conversation_restructures (
 request_id uuid PRIMARY KEY, recording_id uuid NOT NULL REFERENCES public.field_recordings(id), user_id uuid NOT NULL REFERENCES auth.users(id),
 operation text NOT NULL CHECK(operation IN ('split','merge')), payload jsonb NOT NULL, source_ids uuid[] NOT NULL, result_ids uuid[] NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.field_conversation_restructures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.field_conversation_restructures FROM anon,authenticated;
CREATE FUNCTION public.split_field_conversation(p_recording uuid,p_user uuid,p_request uuid,p_conversation uuid,p_version integer,p_before_segment text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.field_recordings; c public.field_conversations; prior public.field_conversation_restructures;
 input jsonb:=jsonb_build_object('conversationId',p_conversation,'version',p_version,'beforeSegmentId',p_before_segment);
 boundary integer; total integer; pieces jsonb[]; piece jsonb; result_ids uuid[]:='{}'; new_id uuid; result jsonb;
BEGIN
 IF p_request IS NULL OR p_version IS NULL OR p_version<1 OR p_before_segment IS NULL OR length(p_before_segment) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Invalid split request' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.field_recording_jobs WHERE recording_id=p_recording ORDER BY id FOR UPDATE;
 SELECT * INTO r FROM public.field_recordings WHERE id=p_recording AND user_id=p_user AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=r.workspace_id AND user_id=p_user) THEN RAISE EXCEPTION 'Recording unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO prior FROM public.field_conversation_restructures WHERE request_id=p_request;
 IF FOUND THEN
  IF prior.user_id<>p_user OR prior.recording_id<>r.id OR prior.operation<>'split' OR prior.payload<>input THEN RAISE EXCEPTION 'Request identity changed' USING ERRCODE='40001'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(child) ORDER BY array_position(prior.result_ids,child.id)),'[]') INTO result FROM public.field_conversations child WHERE child.id=ANY(prior.result_ids);
  RETURN jsonb_build_object('conversations',result,'supersededIds',to_jsonb(prior.source_ids),'history',(SELECT coalesce(jsonb_agg(to_jsonb(original)),'[]') FROM public.field_conversations original WHERE original.id=ANY(prior.source_ids)),'replayed',true);
 END IF;
 SELECT * INTO c FROM public.field_conversations WHERE id=p_conversation AND recording_id=r.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conversation unavailable' USING ERRCODE='P0002'; END IF;
 IF c.version<>p_version OR c.review_state<>'pending' THEN RAISE EXCEPTION 'Conversation changed' USING ERRCODE='40001'; END IF;
 IF c.chunk_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.field_recording_chunks WHERE id=c.chunk_id AND recording_id=r.id AND transcription_state='SUCCESS')
  OR EXISTS(SELECT 1 FROM public.field_recording_jobs WHERE recording_id=r.id AND chunk_id=c.chunk_id AND stage IN ('transcribe','poll') AND status IN ('pending','running')) THEN
  RAISE EXCEPTION 'Finish transcription before splitting' USING ERRCODE='22023'; END IF;
 total:=jsonb_array_length(c.segments);
 IF total<2 OR EXISTS(SELECT 1 FROM jsonb_array_elements(c.segments) segment GROUP BY segment->>'id' HAVING count(*)>1) THEN RAISE EXCEPTION 'Source transcript needs reconciliation' USING ERRCODE='22023'; END IF;
 SELECT ordinality::integer INTO boundary FROM jsonb_array_elements(c.segments) WITH ORDINALITY WHERE value->>'id'=p_before_segment;
 IF boundary IS NULL OR boundary<=1 THEN RAISE EXCEPTION 'Choose a boundary after the first segment' USING ERRCODE='22023'; END IF;
 pieces:=ARRAY[(SELECT jsonb_agg(value ORDER BY ordinality) FROM jsonb_array_elements(c.segments) WITH ORDINALITY WHERE ordinality<boundary),
  (SELECT jsonb_agg(value ORDER BY ordinality) FROM jsonb_array_elements(c.segments) WITH ORDINALITY WHERE ordinality>=boundary)];
 UPDATE public.field_conversations SET review_state='superseded',version=version+1,reviewed_at=now() WHERE id=c.id;
 FOREACH piece IN ARRAY pieces LOOP
  INSERT INTO public.field_conversations(recording_id,chunk_id,segments,timing,parent_conversation_ids)
  VALUES(r.id,c.chunk_id,piece,jsonb_build_object('clock',coalesce(c.timing->>'clock','audio_unaligned'),'spanMs',
   (SELECT max((s->>'endMs')::bigint)-min((s->>'startMs')::bigint) FROM jsonb_array_elements(piece) s),'speechMs',NULL,'restructured',true),ARRAY[c.id]) RETURNING id INTO new_id;
  result_ids:=array_append(result_ids,new_id);
 END LOOP;
 UPDATE public.field_recording_jobs SET stage='analyze',status='pending',attempts=0,error_code=NULL,available_at=now(),lease_token=NULL,lease_until=NULL
 WHERE recording_id=r.id AND chunk_id=c.chunk_id AND stage IN ('analyze','write');
 INSERT INTO public.field_conversation_restructures(request_id,recording_id,user_id,operation,payload,source_ids,result_ids)
 VALUES(p_request,r.id,p_user,'split',input,ARRAY[c.id],result_ids);
 PERFORM public.refresh_field_recording_processing(r.id);
 SELECT jsonb_agg(to_jsonb(child) ORDER BY array_position(result_ids,child.id)) INTO result FROM public.field_conversations child WHERE child.id=ANY(result_ids);
 RETURN jsonb_build_object('conversations',result,'supersededIds',jsonb_build_array(c.id),'history',(SELECT coalesce(jsonb_agg(to_jsonb(original)),'[]') FROM public.field_conversations original WHERE original.id=ANY(ARRAY[c.id])),'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.split_field_conversation(uuid,uuid,uuid,uuid,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.split_field_conversation(uuid,uuid,uuid,uuid,integer,text) TO service_role;
COMMIT;
