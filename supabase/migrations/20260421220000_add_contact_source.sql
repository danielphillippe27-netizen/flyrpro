BEGIN;

ALTER TABLE IF EXISTS public.contacts
  ADD COLUMN IF NOT EXISTS source text;

COMMENT ON COLUMN public.contacts.source IS 'Optional lead source, such as open house, referral, website, or import.';

CREATE INDEX IF NOT EXISTS idx_contacts_workspace_source
  ON public.contacts(workspace_id, source);

COMMIT;
