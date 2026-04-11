BEGIN;

ALTER TABLE public.partner_offers
  ADD COLUMN IF NOT EXISTS email_sent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_recipient text,
  ADD COLUMN IF NOT EXISTS resend_message_id text,
  ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'not_requested';

ALTER TABLE public.partner_offers
  DROP CONSTRAINT IF EXISTS partner_offers_email_status_check;

ALTER TABLE public.partner_offers
  ADD CONSTRAINT partner_offers_email_status_check
  CHECK (email_status IN ('not_requested', 'sent', 'failed'));

CREATE INDEX IF NOT EXISTS idx_partner_offers_email_status
  ON public.partner_offers (email_status);

COMMIT;
