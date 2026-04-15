ALTER TABLE public.farms
  ADD COLUMN IF NOT EXISTS linked_campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_farms_linked_campaign_id
  ON public.farms(linked_campaign_id);
