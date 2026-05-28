BEGIN;

CREATE TABLE IF NOT EXISTS public.ambassador_click_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ambassador_application_id uuid NOT NULL REFERENCES public.ambassador_applications(id) ON DELETE CASCADE,
  referral_code text NOT NULL,
  source text,
  campaign text,
  ip_hash text,
  user_agent text,
  referer text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ambassador_click_events_ambassador_idx
  ON public.ambassador_click_events(ambassador_application_id);

CREATE INDEX IF NOT EXISTS ambassador_click_events_referral_code_idx
  ON public.ambassador_click_events(referral_code);

CREATE INDEX IF NOT EXISTS ambassador_click_events_created_at_idx
  ON public.ambassador_click_events(created_at DESC);

CREATE INDEX IF NOT EXISTS ambassador_click_events_source_idx
  ON public.ambassador_click_events(source);

CREATE INDEX IF NOT EXISTS ambassador_click_events_campaign_idx
  ON public.ambassador_click_events(campaign);

CREATE TABLE IF NOT EXISTS public.ambassador_landing_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ambassador_application_id uuid NOT NULL REFERENCES public.ambassador_applications(id) ON DELETE CASCADE,
  slug text UNIQUE NOT NULL,
  display_name text,
  headline text,
  intro_message text,
  profile_image_url text,
  hero_video_url text,
  audience_type text,
  cta_text text,
  offer_text text,
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ambassador_landing_pages_ambassador_idx
  ON public.ambassador_landing_pages(ambassador_application_id);

CREATE INDEX IF NOT EXISTS ambassador_landing_pages_slug_idx
  ON public.ambassador_landing_pages(slug);

CREATE TABLE IF NOT EXISTS public.ambassador_landing_page_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ambassador_application_id uuid NOT NULL REFERENCES public.ambassador_applications(id) ON DELETE CASCADE,
  landing_page_id uuid REFERENCES public.ambassador_landing_pages(id) ON DELETE CASCADE,
  slug text NOT NULL,
  event_type text NOT NULL DEFAULT 'view',
  ip_hash text,
  user_agent text,
  referer text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ambassador_landing_page_events_ambassador_idx
  ON public.ambassador_landing_page_events(ambassador_application_id);

CREATE INDEX IF NOT EXISTS ambassador_landing_page_events_landing_page_idx
  ON public.ambassador_landing_page_events(landing_page_id);

CREATE INDEX IF NOT EXISTS ambassador_landing_page_events_slug_idx
  ON public.ambassador_landing_page_events(slug);

CREATE INDEX IF NOT EXISTS ambassador_landing_page_events_created_at_idx
  ON public.ambassador_landing_page_events(created_at DESC);

CREATE TABLE IF NOT EXISTS public.ambassador_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ambassador_application_id uuid NOT NULL REFERENCES public.ambassador_applications(id) ON DELETE CASCADE,
  name text NOT NULL,
  source text NOT NULL,
  campaign text NOT NULL,
  destination text NOT NULL DEFAULT 'onboarding',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ambassador_links_ambassador_idx
  ON public.ambassador_links(ambassador_application_id);

CREATE INDEX IF NOT EXISTS ambassador_links_source_idx
  ON public.ambassador_links(source);

CREATE INDEX IF NOT EXISTS ambassador_links_campaign_idx
  ON public.ambassador_links(campaign);

ALTER TABLE public.ambassador_click_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ambassador_landing_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ambassador_landing_page_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ambassador_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ambassador_click_events_service_role_all"
  ON public.ambassador_click_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "ambassador_landing_page_events_service_role_all"
  ON public.ambassador_landing_page_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "ambassador_landing_pages_owner_all"
  ON public.ambassador_landing_pages
  FOR ALL
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.ambassador_applications aa
      WHERE aa.id = ambassador_landing_pages.ambassador_application_id
        AND aa.status = 'approved'
        AND lower(aa.email) = lower(coalesce(auth.email(), ''))
    )
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.ambassador_applications aa
      WHERE aa.id = ambassador_landing_pages.ambassador_application_id
        AND aa.status = 'approved'
        AND lower(aa.email) = lower(coalesce(auth.email(), ''))
    )
  );

CREATE POLICY "ambassador_links_owner_all"
  ON public.ambassador_links
  FOR ALL
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.ambassador_applications aa
      WHERE aa.id = ambassador_links.ambassador_application_id
        AND aa.status = 'approved'
        AND lower(aa.email) = lower(coalesce(auth.email(), ''))
    )
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.ambassador_applications aa
      WHERE aa.id = ambassador_links.ambassador_application_id
        AND aa.status = 'approved'
        AND lower(aa.email) = lower(coalesce(auth.email(), ''))
    )
  );

COMMIT;
