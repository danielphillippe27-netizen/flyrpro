BEGIN;

ALTER TABLE public.ambassador_landing_page_events
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS campaign text;

CREATE INDEX IF NOT EXISTS ambassador_landing_page_events_source_idx
  ON public.ambassador_landing_page_events(source);

CREATE INDEX IF NOT EXISTS ambassador_landing_page_events_campaign_idx
  ON public.ambassador_landing_page_events(campaign);

CREATE INDEX IF NOT EXISTS ambassador_landing_page_events_ambassador_campaign_idx
  ON public.ambassador_landing_page_events(ambassador_application_id, campaign);

COMMIT;
