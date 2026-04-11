BEGIN;

ALTER TABLE public.partner_offers
  ADD COLUMN IF NOT EXISTS is_draft boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_partner_offers_is_draft
  ON public.partner_offers (is_draft, created_at DESC);

COMMIT;
