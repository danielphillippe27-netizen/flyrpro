BEGIN;

CREATE TABLE public.field_recordings (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 user_id uuid NOT NULL REFERENCES auth.users(id),
 session_id uuid NOT NULL REFERENCES public.sessions(id),
 device_serial text NOT NULL CHECK(length(device_serial) BETWEEN 1 AND 120),
 timezone text NOT NULL,
 started_at timestamptz NOT NULL,
 ended_at timestamptz,
 capture_state text NOT NULL DEFAULT 'ready' CHECK(capture_state IN ('ready','start_requested','recording','paused','stop_requested','stopped','unknown','error')),
 processing_state text NOT NULL DEFAULT 'awaiting_file' CHECK(processing_state IN ('awaiting_file','transferring','uploaded','transcription_pending','transcribed','analyzing','needs_review','applied','error','deleted')),
 last_event_sequence bigint NOT NULL DEFAULT -1,
 version integer NOT NULL DEFAULT 1,
 deleted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ended_at IS NULL OR ended_at >= started_at)
);
CREATE INDEX field_recordings_owner ON public.field_recordings(workspace_id,user_id,created_at DESC);

CREATE TABLE public.field_recording_events (
 id uuid PRIMARY KEY,
 recording_id uuid NOT NULL REFERENCES public.field_recordings(id),
 sequence bigint NOT NULL CHECK(sequence >= 0),
 kind text NOT NULL,
 occurred_at timestamptz NOT NULL,
 payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(recording_id,sequence)
);

CREATE TABLE public.field_recording_chunks (
 id uuid PRIMARY KEY,
 recording_id uuid NOT NULL REFERENCES public.field_recordings(id),
 provider_recording_id text NOT NULL,
 storage_path text NOT NULL UNIQUE,
 checksum_sha256 text CHECK(checksum_sha256 ~ '^[a-f0-9]{64}$'),
 byte_count bigint CHECK(byte_count > 0),
 session_offset_ms bigint NOT NULL DEFAULT 0 CHECK(session_offset_ms >= 0),
 duration_ms bigint CHECK(duration_ms >= 0),
 transcription_id text,
 transcription_state text NOT NULL DEFAULT 'awaiting_upload',
 transcript jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(recording_id,provider_recording_id)
);

CREATE TABLE public.field_conversations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recording_id uuid NOT NULL REFERENCES public.field_recordings(id),
 chunk_id uuid REFERENCES public.field_recording_chunks(id),
 target_id uuid,
 target_confirmed boolean NOT NULL DEFAULT false,
 consent text NOT NULL DEFAULT 'unknown' CHECK(consent IN ('unknown','granted','declined')),
 segments jsonb NOT NULL DEFAULT '[]',
 analysis jsonb,
 summary text,
 note text,
 review_state text NOT NULL DEFAULT 'pending' CHECK(review_state IN ('pending','approved','rejected')),
 version integer NOT NULL DEFAULT 1,
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.field_recording_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recording_id uuid NOT NULL REFERENCES public.field_recordings(id),
 chunk_id uuid REFERENCES public.field_recording_chunks(id),
 stage text NOT NULL CHECK(stage IN ('transcribe','poll','analyze','write')),
 deduplication_key text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','done','error','cancelled')),
 attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX field_recording_jobs_ready ON public.field_recording_jobs(status,available_at);

ALTER TABLE public.field_recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_recording_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_recording_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_recording_jobs ENABLE ROW LEVEL SECURITY;
-- All writes go through authenticated, ownership-checked API routes.
REVOKE ALL ON public.field_recordings,public.field_recording_events,public.field_recording_chunks,public.field_conversations,public.field_recording_jobs FROM anon,authenticated;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('field-recordings','field-recordings',false,536870912,ARRAY['audio/mpeg','audio/mp4','audio/wav','audio/x-wav','audio/ogg'])
ON CONFLICT(id) DO NOTHING;

-- Atomic ordering and duplicate suppression across offline event replay.
CREATE FUNCTION public.append_field_recording_event(p_recording uuid,p_user uuid,p_event jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.field_recordings; existing public.field_recording_events; next_state text;
BEGIN
 SELECT * INTO r FROM public.field_recordings WHERE id=p_recording AND user_id=p_user AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Recording unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO existing FROM public.field_recording_events WHERE id=(p_event->>'id')::uuid;
 IF FOUND THEN
  IF existing.recording_id<>r.id OR existing.payload IS DISTINCT FROM p_event THEN RAISE EXCEPTION 'Event identity conflict'; END IF;
  RETURN to_jsonb(r);
 END IF;
 IF (p_event->>'sequence')::bigint <> r.last_event_sequence+1 THEN RAISE EXCEPTION 'Event sequence gap or conflict'; END IF;
 IF p_event->>'kind' NOT IN ('start_requested','start_confirmed','stop_requested','stop_confirmed','disconnected','reconnected','door_started','door_finished','paused','resumed','error') THEN RAISE EXCEPTION 'Invalid event'; END IF;
 next_state := CASE p_event->>'kind'
  WHEN 'start_requested' THEN 'start_requested' WHEN 'start_confirmed' THEN 'recording'
  WHEN 'stop_requested' THEN 'stop_requested' WHEN 'stop_confirmed' THEN 'stopped'
  WHEN 'paused' THEN 'paused' WHEN 'resumed' THEN 'recording'
  WHEN 'disconnected' THEN CASE WHEN r.capture_state IN ('ready','stopped') THEN r.capture_state ELSE 'unknown' END
  WHEN 'error' THEN 'error' ELSE r.capture_state END;
 INSERT INTO public.field_recording_events(id,recording_id,sequence,kind,occurred_at,payload)
 VALUES((p_event->>'id')::uuid,r.id,(p_event->>'sequence')::bigint,p_event->>'kind',(p_event->>'occurredAt')::timestamptz,p_event);
 UPDATE public.field_recordings SET capture_state=next_state,last_event_sequence=(p_event->>'sequence')::bigint,
  version=version+1,updated_at=now() WHERE id=r.id RETURNING * INTO r;
 RETURN to_jsonb(r);
END $$;
REVOKE ALL ON FUNCTION public.append_field_recording_event(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.append_field_recording_event(uuid,uuid,jsonb) TO service_role;
COMMIT;
