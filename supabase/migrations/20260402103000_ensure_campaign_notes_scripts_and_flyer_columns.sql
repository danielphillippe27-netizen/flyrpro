-- Ensure Notes tab fields exist on campaigns in every environment.
-- Older environments may be missing one or more of these columns.
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS scripts text,
  ADD COLUMN IF NOT EXISTS flyer_url text;

COMMENT ON COLUMN public.campaigns.notes IS 'Free-form notes for the campaign';
COMMENT ON COLUMN public.campaigns.scripts IS 'Script/dialogue content for the campaign';
COMMENT ON COLUMN public.campaigns.flyer_url IS 'URL of uploaded flyer image or PDF (photo of flyer used)';
