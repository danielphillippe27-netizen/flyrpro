CREATE TABLE IF NOT EXISTS public.salesperson_demo_video_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  salesperson_id uuid NOT NULL REFERENCES public.salespeople(id) ON DELETE CASCADE,
  referral_code text NOT NULL,
  session_id text NOT NULL,
  event_type text NOT NULL CHECK (
    event_type IN (
      'page_view',
      'video_started',
      'play_with_sound',
      'progress_25',
      'progress_50',
      'progress_75',
      'video_complete',
      'cta_shown',
      'start_trial_click',
      'founder_call_click',
      'page_exit'
    )
  ),
  source text,
  campaign text,
  watch_seconds integer NOT NULL DEFAULT 0,
  max_watch_seconds integer NOT NULL DEFAULT 0,
  video_duration_seconds integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_hash text,
  user_agent text,
  referer text
);

CREATE INDEX IF NOT EXISTS salesperson_demo_video_events_salesperson_created_idx
  ON public.salesperson_demo_video_events (salesperson_id, created_at DESC);

CREATE INDEX IF NOT EXISTS salesperson_demo_video_events_referral_code_created_idx
  ON public.salesperson_demo_video_events (referral_code, created_at DESC);

CREATE INDEX IF NOT EXISTS salesperson_demo_video_events_session_idx
  ON public.salesperson_demo_video_events (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS salesperson_demo_video_events_type_idx
  ON public.salesperson_demo_video_events (event_type, created_at DESC);

ALTER TABLE public.salesperson_demo_video_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "salesperson_demo_video_events_service_role_all"
  ON public.salesperson_demo_video_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
