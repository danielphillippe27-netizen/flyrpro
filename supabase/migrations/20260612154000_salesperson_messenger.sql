CREATE TABLE IF NOT EXISTS public.salesperson_messenger_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  key text NOT NULL UNIQUE,
  title text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_message_at timestamptz,
  last_message_preview text
);

CREATE TABLE IF NOT EXISTS public.salesperson_messenger_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  thread_id uuid NOT NULL REFERENCES public.salesperson_messenger_threads(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  salesperson_id uuid REFERENCES public.salespeople(id) ON DELETE SET NULL,
  body text,
  gif_url text,
  gif_title text,
  message_type text NOT NULL DEFAULT 'text'
    CHECK (message_type IN ('text', 'gif', 'mixed')),
  CHECK (
    (body IS NOT NULL AND length(trim(body)) > 0)
    OR (gif_url IS NOT NULL AND length(trim(gif_url)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS salesperson_messenger_messages_thread_created_idx
  ON public.salesperson_messenger_messages (thread_id, created_at DESC);

CREATE INDEX IF NOT EXISTS salesperson_messenger_messages_sender_idx
  ON public.salesperson_messenger_messages (sender_user_id, created_at DESC);

ALTER TABLE public.salesperson_messenger_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salesperson_messenger_messages ENABLE ROW LEVEL SECURITY;
