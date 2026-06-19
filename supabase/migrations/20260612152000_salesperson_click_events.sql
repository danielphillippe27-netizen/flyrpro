CREATE TABLE IF NOT EXISTS public.salesperson_click_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  salesperson_id uuid NOT NULL REFERENCES public.salespeople(id) ON DELETE CASCADE,
  referral_code text NOT NULL,
  source text,
  campaign text,
  ip_hash text,
  user_agent text,
  referer text
);

CREATE INDEX IF NOT EXISTS salesperson_click_events_salesperson_created_idx
  ON public.salesperson_click_events (salesperson_id, created_at DESC);

CREATE INDEX IF NOT EXISTS salesperson_click_events_referral_code_created_idx
  ON public.salesperson_click_events (referral_code, created_at DESC);

CREATE INDEX IF NOT EXISTS salesperson_click_events_source_campaign_idx
  ON public.salesperson_click_events (source, campaign);

ALTER TABLE public.salesperson_click_events ENABLE ROW LEVEL SECURITY;
