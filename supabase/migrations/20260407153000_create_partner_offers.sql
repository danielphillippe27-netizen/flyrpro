-- Founder-managed partner offers with tokenized public links.
-- Enables invite-style pages such as /partner-offer/<token>.

BEGIN;

CREATE TABLE IF NOT EXISTS public.partner_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  recipient_name text,
  recipient_email text,
  partner_name text NOT NULL,
  offer_title text NOT NULL,
  offer_message text,
  cta_label text,
  cta_url text,
  max_views integer CHECK (max_views IS NULL OR max_views > 0),
  view_count integer NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  expires_at timestamptz NOT NULL,
  last_viewed_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_offers_expires_at
  ON public.partner_offers (expires_at);

CREATE INDEX IF NOT EXISTS idx_partner_offers_created_at
  ON public.partner_offers (created_at DESC);

ALTER TABLE public.partner_offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "partner_offers_founder_manage" ON public.partner_offers;
CREATE POLICY "partner_offers_founder_manage"
  ON public.partner_offers
  FOR ALL
  USING (public.is_founder() OR auth.role() = 'service_role')
  WITH CHECK (public.is_founder() OR auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.partner_offers_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_partner_offers_updated_at ON public.partner_offers;
CREATE TRIGGER trg_partner_offers_updated_at
  BEFORE UPDATE ON public.partner_offers
  FOR EACH ROW
  EXECUTE FUNCTION public.partner_offers_set_updated_at();

COMMENT ON TABLE public.partner_offers IS
  'Founder-created exclusive offer links served by tokenized route.';

COMMIT;
