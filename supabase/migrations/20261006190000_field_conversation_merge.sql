BEGIN;
CREATE FUNCTION public.merge_field_conversations(p_recording uuid,p_user uuid,p_request uuid,p_sources jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.field_recordings; prior public.field_conversation_restructures;
 source_ids uuid[]; chunk uuid; segments jsonb; new_id uuid; result jsonb; aligned boolean;
BEGIN
 IF p_request IS NULL OR jsonb_typeof(p_sources) IS DISTINCT FROM 'array' OR jsonb_array_length(p_sources) NOT BETWEEN 2 AND 20 THEN RAISE EXCEPTION 'Choose two to twenty conversations' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_sources) s WHERE jsonb_typeof(s) IS DISTINCT FROM 'object' OR (s->>'version')::integer<1 OR s->>'id' IS NULL OR s->>'version' IS NULL) THEN RAISE EXCEPTION 'Invalid conversation versions' USING ERRCODE='22023'; END IF;
 SELECT array_agg((value->>'id')::uuid ORDER BY ordinality) INTO source_ids FROM jsonb_array_elements(p_sources) WITH ORDINALITY s;
 IF cardinality(source_ids)<>(SELECT count(DISTINCT id) FROM unnest(source_ids) id) THEN RAISE EXCEPTION 'Choose distinct conversations' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.field_recording_jobs WHERE recording_id=p_recording ORDER BY id FOR UPDATE;
 SELECT * INTO r FROM public.field_recordings WHERE id=p_recording AND user_id=p_user AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=r.workspace_id AND user_id=p_user) THEN RAISE EXCEPTION 'Recording unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO prior FROM public.field_conversation_restructures WHERE request_id=p_request;
 IF FOUND THEN
  IF prior.user_id<>p_user OR prior.recording_id<>r.id OR prior.operation<>'merge' OR prior.payload<>p_sources THEN RAISE EXCEPTION 'Request identity changed' USING ERRCODE='40001'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(child) ORDER BY array_position(prior.result_ids,child.id)),'[]') INTO result FROM public.field_conversations child WHERE child.id=ANY(prior.result_ids);
  RETURN jsonb_build_object('conversations',result,'supersededIds',to_jsonb(prior.source_ids),'history',(SELECT coalesce(jsonb_agg(to_jsonb(original)),'[]') FROM public.field_conversations original WHERE original.id=ANY(prior.source_ids)),'replayed',true);
 END IF;
 PERFORM 1 FROM public.field_conversations WHERE id=ANY(source_ids) AND recording_id=r.id ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM public.field_conversations WHERE id=ANY(source_ids) AND recording_id=r.id)<>cardinality(source_ids) THEN RAISE EXCEPTION 'Conversation unavailable' USING ERRCODE='P0002'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_sources) s JOIN public.field_conversations c ON c.id=(s->>'id')::uuid WHERE c.version<>(s->>'version')::integer OR c.review_state<>'pending') THEN RAISE EXCEPTION 'Conversation changed' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM public.field_conversations c WHERE c.id=ANY(source_ids) AND (jsonb_typeof(c.segments) IS DISTINCT FROM 'array' OR jsonb_array_length(c.segments)=0)) THEN RAISE EXCEPTION 'Source transcript needs reconciliation' USING ERRCODE='22023'; END IF;
 IF (SELECT count(DISTINCT chunk_id) FROM public.field_conversations WHERE id=ANY(source_ids))<>1 OR EXISTS(SELECT 1 FROM public.field_conversations WHERE id=ANY(source_ids) AND chunk_id IS NULL) THEN RAISE EXCEPTION 'Cross-file merge requires additional timeline review' USING ERRCODE='22023'; END IF;
 SELECT chunk_id INTO chunk FROM public.field_conversations WHERE id=source_ids[1];
 IF NOT EXISTS(SELECT 1 FROM public.field_recording_chunks WHERE id=chunk AND recording_id=r.id AND transcription_state='SUCCESS') OR EXISTS(SELECT 1 FROM public.field_recording_jobs WHERE recording_id=r.id AND chunk_id=chunk AND stage IN ('transcribe','poll') AND status IN ('pending','running')) THEN RAISE EXCEPTION 'Finish transcription before merging' USING ERRCODE='22023'; END IF;
 SELECT jsonb_agg(s ORDER BY (s->>'startMs')::bigint,(s->>'endMs')::bigint,s->>'id') INTO segments FROM public.field_conversations c CROSS JOIN LATERAL jsonb_array_elements(c.segments) s WHERE c.id=ANY(source_ids);
 IF segments IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(segments) s GROUP BY s->>'id' HAVING count(*)>1) OR (SELECT sum(length(s->>'text')) FROM jsonb_array_elements(segments) s)>55000 THEN RAISE EXCEPTION 'Transcript needs reconciliation or a smaller merge' USING ERRCODE='22023'; END IF;
 SELECT bool_and(coalesce(timing->>'clock','audio_unaligned')='campaign') INTO aligned FROM public.field_conversations WHERE id=ANY(source_ids);
 UPDATE public.field_conversations SET review_state='superseded',version=version+1,reviewed_at=now() WHERE id=ANY(source_ids);
 INSERT INTO public.field_conversations(recording_id,chunk_id,segments,timing,parent_conversation_ids)
 VALUES(r.id,chunk,segments,jsonb_build_object('clock',CASE WHEN aligned THEN 'campaign' ELSE 'audio_unaligned' END,'spanMs',(SELECT max((s->>'endMs')::bigint)-min((s->>'startMs')::bigint) FROM jsonb_array_elements(segments) s),'speechMs',NULL,'restructured',true),source_ids) RETURNING id INTO new_id;
 UPDATE public.field_recording_jobs SET stage='analyze',status='pending',attempts=0,error_code=NULL,available_at=now(),lease_token=NULL,lease_until=NULL WHERE recording_id=r.id AND chunk_id=chunk AND stage IN ('analyze','write');
 INSERT INTO public.field_conversation_restructures(request_id,recording_id,user_id,operation,payload,source_ids,result_ids) VALUES(p_request,r.id,p_user,'merge',p_sources,source_ids,ARRAY[new_id]);
 PERFORM public.refresh_field_recording_processing(r.id);
 SELECT jsonb_build_array(to_jsonb(child)) INTO result FROM public.field_conversations child WHERE id=new_id;
 RETURN jsonb_build_object('conversations',result,'supersededIds',to_jsonb(source_ids),'history',(SELECT coalesce(jsonb_agg(to_jsonb(original)),'[]') FROM public.field_conversations original WHERE original.id=ANY(source_ids)),'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.merge_field_conversations(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.merge_field_conversations(uuid,uuid,uuid,jsonb) TO service_role;
COMMIT;
