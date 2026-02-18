-- Campaign contacts (leads): people with name, phone, email, etc.
-- Total "leads" in the campaign = count of rows here (0 until user adds contacts).
CREATE TABLE IF NOT EXISTS public.campaign_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  address_id uuid REFERENCES public.campaign_addresses(id) ON DELETE SET NULL,
  name text,
  phone text,
  email text,
  address text,
  last_contacted_at timestamptz,
  interest_level text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_contacts_campaign_id ON public.campaign_contacts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_last_contacted ON public.campaign_contacts(last_contacted_at DESC NULLS LAST);

ALTER TABLE public.campaign_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view contacts for their campaigns" ON public.campaign_contacts;
CREATE POLICY "Users can view contacts for their campaigns"
  ON public.campaign_contacts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_contacts.campaign_id AND c.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert contacts for their campaigns" ON public.campaign_contacts;
CREATE POLICY "Users can insert contacts for their campaigns"
  ON public.campaign_contacts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_contacts.campaign_id AND c.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update contacts for their campaigns" ON public.campaign_contacts;
CREATE POLICY "Users can update contacts for their campaigns"
  ON public.campaign_contacts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_contacts.campaign_id AND c.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete contacts for their campaigns" ON public.campaign_contacts;
CREATE POLICY "Users can delete contacts for their campaigns"
  ON public.campaign_contacts FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_contacts.campaign_id AND c.owner_id = auth.uid()
    )
  );

COMMENT ON TABLE public.campaign_contacts IS 'Leads/contacts for a campaign (name, phone, email, etc.). Total leads = count of this table.';
