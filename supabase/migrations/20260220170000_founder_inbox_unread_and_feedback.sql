-- Founder inbox upgrades:
-- - support thread unread/needs-reply state + mark-read RPCs
-- - iOS feedback channel tables + mark-read RPC
-- - realtime publication for support/feedback inserts

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) Support tables (create if missing for clean environments)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.support_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.support_threads(id) ON DELETE CASCADE,
  sender_type text NOT NULL CHECK (sender_type IN ('user', 'support')),
  sender_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_threads_last_message_at
  ON public.support_threads(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_messages_thread_created_at
  ON public.support_messages(thread_id, created_at DESC);

ALTER TABLE public.support_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'support_threads'
      AND policyname = 'support_threads_select_access'
  ) THEN
    CREATE POLICY "support_threads_select_access"
      ON public.support_threads
      FOR SELECT
      USING (
        user_id = auth.uid()
        OR public.is_founder()
        OR EXISTS (
          SELECT 1
          FROM public.profiles p
          WHERE p.id = auth.uid()
            AND p.is_support = true
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'support_threads'
      AND policyname = 'support_threads_insert_own'
  ) THEN
    CREATE POLICY "support_threads_insert_own"
      ON public.support_threads
      FOR INSERT
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'support_messages'
      AND policyname = 'support_messages_select_access'
  ) THEN
    CREATE POLICY "support_messages_select_access"
      ON public.support_messages
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.support_threads st
          WHERE st.id = support_messages.thread_id
            AND (
              st.user_id = auth.uid()
              OR public.is_founder()
              OR EXISTS (
                SELECT 1
                FROM public.profiles p
                WHERE p.id = auth.uid()
                  AND p.is_support = true
              )
            )
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'support_messages'
      AND policyname = 'support_messages_insert_access'
  ) THEN
    CREATE POLICY "support_messages_insert_access"
      ON public.support_messages
      FOR INSERT
      WITH CHECK (
        sender_user_id = auth.uid()
        AND EXISTS (
          SELECT 1
          FROM public.support_threads st
          WHERE st.id = support_messages.thread_id
            AND (
              (support_messages.sender_type = 'user' AND st.user_id = auth.uid())
              OR (
                support_messages.sender_type = 'support'
                AND (
                  public.is_founder()
                  OR EXISTS (
                    SELECT 1
                    FROM public.profiles p
                    WHERE p.id = auth.uid()
                      AND p.is_support = true
                  )
                )
              )
            )
        )
      );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- A1) Add support thread state columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.support_threads
  ADD COLUMN IF NOT EXISTS last_sender_type text,
  ADD COLUMN IF NOT EXISTS last_message_id uuid,
  ADD COLUMN IF NOT EXISTS last_message_preview text,
  ADD COLUMN IF NOT EXISTS needs_reply boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS unread_for_support boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS unread_for_user boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_support_threads_needs_reply
  ON public.support_threads(needs_reply)
  WHERE needs_reply = true;

CREATE INDEX IF NOT EXISTS idx_support_threads_unread_for_support
  ON public.support_threads(unread_for_support)
  WHERE unread_for_support = true;

CREATE INDEX IF NOT EXISTS idx_support_threads_unread_for_user
  ON public.support_threads(unread_for_user)
  WHERE unread_for_user = true;

-- Backfill thread state from latest message.
WITH latest AS (
  SELECT DISTINCT ON (sm.thread_id)
    sm.thread_id,
    sm.id,
    sm.sender_type,
    sm.body,
    sm.created_at
  FROM public.support_messages sm
  ORDER BY sm.thread_id, sm.created_at DESC, sm.id DESC
)
UPDATE public.support_threads st
SET
  last_message_at = COALESCE(latest.created_at, st.last_message_at, st.created_at, now()),
  last_sender_type = COALESCE(latest.sender_type, st.last_sender_type),
  last_message_id = COALESCE(latest.id, st.last_message_id),
  last_message_preview = COALESCE(left(latest.body, 120), st.last_message_preview),
  needs_reply = CASE
    WHEN latest.sender_type = 'user' THEN true
    WHEN latest.sender_type = 'support' THEN false
    ELSE st.needs_reply
  END,
  unread_for_support = CASE
    WHEN latest.sender_type = 'user' THEN true
    ELSE st.unread_for_support
  END,
  unread_for_user = CASE
    WHEN latest.sender_type = 'support' THEN true
    ELSE st.unread_for_user
  END,
  updated_at = now()
FROM latest
WHERE st.id = latest.thread_id;

-- ---------------------------------------------------------------------------
-- A2) Trigger to keep support thread state updated per new message
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.support_on_message_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.support_threads
  SET
    last_message_at = COALESCE(NEW.created_at, now()),
    last_sender_type = NEW.sender_type,
    last_message_id = NEW.id,
    last_message_preview = left(COALESCE(NEW.body, ''), 120),
    needs_reply = CASE
      WHEN NEW.sender_type = 'user' THEN true
      WHEN NEW.sender_type = 'support' THEN false
      ELSE needs_reply
    END,
    unread_for_support = CASE
      WHEN NEW.sender_type = 'user' THEN true
      ELSE unread_for_support
    END,
    unread_for_user = CASE
      WHEN NEW.sender_type = 'support' THEN true
      ELSE unread_for_user
    END,
    updated_at = now()
  WHERE id = NEW.thread_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_support_on_message_insert ON public.support_messages;
CREATE TRIGGER trg_support_on_message_insert
  AFTER INSERT ON public.support_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.support_on_message_insert();

-- ---------------------------------------------------------------------------
-- A3) Mark-read RPCs (support and user)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.support_mark_thread_read_for_support(p_thread_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_support boolean := false;
BEGIN
  SELECT COALESCE(p.is_support, false)
  INTO v_is_support
  FROM public.profiles p
  WHERE p.id = auth.uid();

  IF NOT public.is_founder() AND NOT v_is_support THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.support_threads
  SET unread_for_support = false,
      updated_at = now()
  WHERE id = p_thread_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.support_mark_thread_read_for_user(p_thread_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid;
BEGIN
  SELECT st.user_id
  INTO v_owner_id
  FROM public.support_threads st
  WHERE st.id = p_thread_id;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'thread not found';
  END IF;

  IF v_owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.support_threads
  SET unread_for_user = false,
      updated_at = now()
  WHERE id = p_thread_id;
END;
$$;

REVOKE ALL ON FUNCTION public.support_mark_thread_read_for_support(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.support_mark_thread_read_for_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_mark_thread_read_for_support(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_mark_thread_read_for_user(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- A4) iOS feedback channel tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.feedback_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  last_feedback_at timestamptz NOT NULL DEFAULT now(),
  unread_for_founder boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.feedback_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.feedback_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('bug', 'feature', 'other')),
  title text,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_threads_user_id
  ON public.feedback_threads(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_threads_last_feedback_at
  ON public.feedback_threads(last_feedback_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_threads_unread_for_founder
  ON public.feedback_threads(unread_for_founder)
  WHERE unread_for_founder = true;
CREATE INDEX IF NOT EXISTS idx_feedback_items_thread_created
  ON public.feedback_items(thread_id, created_at DESC);

ALTER TABLE public.feedback_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feedback_threads_select_owner_or_founder" ON public.feedback_threads;
CREATE POLICY "feedback_threads_select_owner_or_founder"
ON public.feedback_threads
FOR SELECT
USING (
  user_id = auth.uid()
  OR public.is_founder()
);

DROP POLICY IF EXISTS "feedback_threads_insert_owner_only" ON public.feedback_threads;
CREATE POLICY "feedback_threads_insert_owner_only"
ON public.feedback_threads
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
);

DROP POLICY IF EXISTS "feedback_items_select_owner_or_founder" ON public.feedback_items;
CREATE POLICY "feedback_items_select_owner_or_founder"
ON public.feedback_items
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.feedback_threads ft
    WHERE ft.id = feedback_items.thread_id
      AND (ft.user_id = auth.uid() OR public.is_founder())
  )
);

DROP POLICY IF EXISTS "feedback_items_insert_owner_only" ON public.feedback_items;
CREATE POLICY "feedback_items_insert_owner_only"
ON public.feedback_items
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.feedback_threads ft
    WHERE ft.id = feedback_items.thread_id
      AND ft.user_id = auth.uid()
  )
);

CREATE OR REPLACE FUNCTION public.feedback_on_item_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.feedback_threads
  SET
    last_feedback_at = COALESCE(NEW.created_at, now()),
    unread_for_founder = true,
    updated_at = now()
  WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feedback_on_item_insert ON public.feedback_items;
CREATE TRIGGER trg_feedback_on_item_insert
  AFTER INSERT ON public.feedback_items
  FOR EACH ROW
  EXECUTE FUNCTION public.feedback_on_item_insert();

CREATE OR REPLACE FUNCTION public.feedback_mark_read(p_thread_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_founder() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.feedback_threads
  SET unread_for_founder = false,
      updated_at = now()
  WHERE id = p_thread_id;
END;
$$;

REVOKE ALL ON FUNCTION public.feedback_mark_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.feedback_mark_read(uuid) TO authenticated;

GRANT SELECT, INSERT, UPDATE ON public.feedback_threads TO authenticated;
GRANT SELECT, INSERT ON public.feedback_items TO authenticated;

-- ---------------------------------------------------------------------------
-- Realtime publication
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.support_messages') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_rel pr
       JOIN pg_class c ON c.oid = pr.prrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_publication p ON p.oid = pr.prpubid
       WHERE p.pubname = 'supabase_realtime'
         AND n.nspname = 'public'
         AND c.relname = 'support_messages'
     ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.support_messages';
  END IF;

  IF to_regclass('public.feedback_items') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_rel pr
       JOIN pg_class c ON c.oid = pr.prrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_publication p ON p.oid = pr.prpubid
       WHERE p.pubname = 'supabase_realtime'
         AND n.nspname = 'public'
         AND c.relname = 'feedback_items'
     ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.feedback_items';
  END IF;
END
$$;

COMMIT;
