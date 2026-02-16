-- Address-level status for campaign address map (address-based).
-- Used by web and iOS for coloring: green = delivered, blue = talked/appointment.
-- See docs/MAP_STATUS_QUICK_REFERENCE.md.

CREATE TABLE IF NOT EXISTS public.address_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_address_id uuid NOT NULL REFERENCES public.campaign_addresses(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'none' CHECK (status IN (
    'none',
    'no_answer',
    'delivered',
    'talked',
    'appointment',
    'do_not_knock',
    'future_seller',
    'hot_lead'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_address_id)
);

CREATE INDEX IF NOT EXISTS idx_address_statuses_campaign_address_id ON public.address_statuses(campaign_address_id);
CREATE INDEX IF NOT EXISTS idx_address_statuses_status ON public.address_statuses(status);

ALTER TABLE public.address_statuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage address_statuses for their campaign addresses"
  ON public.address_statuses FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.campaign_addresses ca
      JOIN public.campaigns c ON c.id = ca.campaign_id
      WHERE ca.id = address_statuses.campaign_address_id
        AND c.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.campaign_addresses ca
      JOIN public.campaigns c ON c.id = ca.campaign_id
      WHERE ca.id = address_statuses.campaign_address_id
        AND c.owner_id = auth.uid()
    )
  );

COMMENT ON TABLE public.address_statuses IS 'Address-level status for campaign address map. Green = delivered, blue = talked/appointment.';
