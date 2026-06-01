-- Canonical one-owner address-to-parcel links for campaign MapBundles.
-- One address may belong to exactly one canonical parcel per campaign.

CREATE TABLE IF NOT EXISTS public.campaign_address_parcel_links (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  address_id uuid NOT NULL REFERENCES public.campaign_addresses(id) ON DELETE CASCADE,
  campaign_parcel_id uuid REFERENCES public.campaign_parcels(id) ON DELETE SET NULL,
  parcel_id text NOT NULL,
  match_type text NOT NULL DEFAULT 'contains',
  confidence double precision NOT NULL DEFAULT 1,
  parcel_area_sqm double precision,
  distance_meters double precision,
  source_version text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT campaign_address_parcel_links_campaign_address_key UNIQUE (campaign_id, address_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_address_parcel_links_campaign_parcel
  ON public.campaign_address_parcel_links(campaign_id, parcel_id);

CREATE INDEX IF NOT EXISTS idx_campaign_address_parcel_links_campaign_parcel_id
  ON public.campaign_address_parcel_links(campaign_parcel_id);

CREATE INDEX IF NOT EXISTS idx_campaign_address_parcel_links_address
  ON public.campaign_address_parcel_links(address_id);

ALTER TABLE public.campaign_address_parcel_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaign_address_parcel_links_select_owner" ON public.campaign_address_parcel_links;
CREATE POLICY "campaign_address_parcel_links_select_owner"
  ON public.campaign_address_parcel_links
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.campaigns c
      WHERE c.id = campaign_address_parcel_links.campaign_id
        AND c.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "campaign_address_parcel_links_service_manage" ON public.campaign_address_parcel_links;
CREATE POLICY "campaign_address_parcel_links_service_manage"
  ON public.campaign_address_parcel_links
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON public.campaign_address_parcel_links TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_address_parcel_links TO service_role;
