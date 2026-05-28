BEGIN;

ALTER TABLE public.ambassador_referrals
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS campaign text;

CREATE INDEX IF NOT EXISTS ambassador_referrals_source_idx
  ON public.ambassador_referrals(source);

CREATE INDEX IF NOT EXISTS ambassador_referrals_campaign_idx
  ON public.ambassador_referrals(campaign);

CREATE INDEX IF NOT EXISTS ambassador_referrals_ambassador_source_campaign_idx
  ON public.ambassador_referrals(ambassador_application_id, source, campaign);

COMMIT;
