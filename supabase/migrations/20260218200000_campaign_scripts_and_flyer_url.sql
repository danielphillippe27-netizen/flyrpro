-- Add scripts and flyer_url to campaigns for Notes tab
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS scripts text,
  ADD COLUMN IF NOT EXISTS flyer_url text;

COMMENT ON COLUMN public.campaigns.scripts IS 'Script/dialogue content for the campaign';
COMMENT ON COLUMN public.campaigns.flyer_url IS 'URL of uploaded flyer image or PDF (photo of flyer used)';
