BEGIN;

CREATE TABLE IF NOT EXISTS public.session_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  workspace_id uuid NULL REFERENCES public.workspaces(id) ON DELETE SET NULL,
  -- Keep the immutable sender id even if the account is later deleted. Chat
  -- retention follows the session lifecycle, not the auth-user lifecycle.
  sender_user_id uuid NOT NULL,
  client_message_id uuid NOT NULL,
  message_type text NOT NULL CHECK (message_type IN ('text', 'voice')),
  text_body text NULL,
  audio_path text NULL,
  audio_duration_ms integer NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_chat_message_payload_check CHECK (
    (
      message_type = 'text'
      AND text_body IS NOT NULL
      AND length(btrim(text_body)) BETWEEN 1 AND 1000
      AND audio_path IS NULL
      AND audio_duration_ms IS NULL
    )
    OR
    (
      message_type = 'voice'
      AND text_body IS NULL
      AND audio_path IS NOT NULL
      AND audio_duration_ms BETWEEN 1000 AND 120000
    )
  ),
  CONSTRAINT session_chat_client_message_unique
    UNIQUE (session_id, sender_user_id, client_message_id)
);

CREATE INDEX IF NOT EXISTS idx_session_chat_messages_session_created
  ON public.session_chat_messages(session_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_session_chat_messages_campaign_created
  ON public.session_chat_messages(campaign_id, created_at DESC);

ALTER TABLE public.session_participants
  ADD COLUMN IF NOT EXISTS chat_last_read_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS chat_last_read_message_id uuid NULL
    REFERENCES public.session_chat_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_session_participants_user_chat_rooms
  ON public.session_participants(user_id, last_seen_at DESC);

-- Historical chat access is deliberately different from live presence: a participant
-- may keep reading after leaving, but must still belong to the campaign today.
CREATE OR REPLACE FUNCTION public.can_view_session_chat(
  p_session_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.session_participants sp
    WHERE sp.session_id = p_session_id
      AND sp.user_id = p_user_id
      AND public.can_view_campaign(sp.campaign_id, p_user_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_send_session_chat(
  p_session_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.session_participants sp
    JOIN public.sessions s ON s.id = sp.session_id
    WHERE sp.session_id = p_session_id
      AND sp.user_id = p_user_id
      AND sp.left_at IS NULL
      AND s.end_time IS NULL
      AND public.can_view_campaign(sp.campaign_id, p_user_id)
  );
$$;

ALTER TABLE public.session_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "session_chat_select_participant" ON public.session_chat_messages;
CREATE POLICY "session_chat_select_participant"
  ON public.session_chat_messages FOR SELECT
  TO authenticated
  USING (public.can_view_session_chat(session_id));

DROP POLICY IF EXISTS "session_chat_insert_active_participant" ON public.session_chat_messages;
CREATE POLICY "session_chat_insert_active_participant"
  ON public.session_chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_user_id = auth.uid()
    AND public.can_send_session_chat(session_id)
    AND EXISTS (
      SELECT 1
      FROM public.sessions s
      WHERE s.id = session_id
        AND s.campaign_id = campaign_id
        AND s.workspace_id IS NOT DISTINCT FROM workspace_id
    )
  );

DROP POLICY IF EXISTS "session_chat_service_role" ON public.session_chat_messages;
CREATE POLICY "session_chat_service_role"
  ON public.session_chat_messages FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT ON public.session_chat_messages TO authenticated;
GRANT ALL ON public.session_chat_messages TO service_role;
GRANT EXECUTE ON FUNCTION public.can_view_session_chat(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_send_session_chat(uuid, uuid) TO authenticated, service_role;

-- Older builds did not create a participant row for the host. Backfill it so every
-- campaign session has a durable owner room and future history authorization is uniform.
INSERT INTO public.session_participants (
  session_id,
  campaign_id,
  user_id,
  role,
  joined_at,
  left_at,
  last_seen_at
)
SELECT
  s.id,
  s.campaign_id,
  s.user_id,
  'host',
  s.start_time,
  CASE WHEN s.end_time IS NULL THEN NULL ELSE s.end_time END,
  COALESCE(s.end_time, s.start_time)
FROM public.sessions s
WHERE s.campaign_id IS NOT NULL
ON CONFLICT (session_id, user_id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'session-chat-voice',
  'session-chat-voice',
  false,
  4194304,
  ARRAY['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "session_chat_voice_service_role" ON storage.objects;
CREATE POLICY "session_chat_voice_service_role"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'session-chat-voice')
  WITH CHECK (bucket_id = 'session-chat-voice');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_rel pr
    JOIN pg_class c ON c.oid = pr.prrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_publication p ON p.oid = pr.prpubid
    WHERE p.pubname = 'supabase_realtime'
      AND n.nspname = 'public'
      AND c.relname = 'session_chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.session_chat_messages;
  END IF;
END
$$;

COMMIT;
