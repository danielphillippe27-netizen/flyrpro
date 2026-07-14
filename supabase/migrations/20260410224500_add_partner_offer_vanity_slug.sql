BEGIN;

ALTER TABLE public.partner_offers
  ADD COLUMN IF NOT EXISTS vanity_slug text;

ALTER TABLE public.partner_offers
  DROP CONSTRAINT IF EXISTS partner_offers_vanity_slug_format_check;

ALTER TABLE public.partner_offers
  ADD CONSTRAINT partner_offers_vanity_slug_format_check
  CHECK (
    vanity_slug IS NULL
    OR vanity_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_offers_vanity_slug
  ON public.partner_offers (vanity_slug)
  WHERE vanity_slug IS NOT NULL;

COMMENT ON COLUMN public.partner_offers.vanity_slug IS
  'Optional branded public path segment such as wolfgrid.app/acme-realty-group.';

COMMIT;
