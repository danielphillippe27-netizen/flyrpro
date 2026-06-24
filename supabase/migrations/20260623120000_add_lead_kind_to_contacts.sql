BEGIN;

-- Distinguish field-captured leads from salesperson-imported (scraped/dialler) leads.
-- Existing rows default to 'field' — no data loss, no backfill needed for genuine field leads.
-- Scraper/import paths must set lead_kind = 'scraped' going forward.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS lead_kind TEXT NOT NULL DEFAULT 'field'
    CHECK (lead_kind IN ('field', 'scraped'));

CREATE INDEX IF NOT EXISTS idx_contacts_user_lead_kind
  ON public.contacts (user_id, lead_kind);

COMMENT ON COLUMN public.contacts.lead_kind IS
  'Discriminates field-captured doorknocker leads (field) from salesperson-imported cold-call targets (scraped). Stats and iOS counts should filter to lead_kind = field.';

COMMIT;
