BEGIN;

ALTER TABLE IF EXISTS public.contacts
  ADD COLUMN IF NOT EXISTS follow_up_at timestamptz,
  ADD COLUMN IF NOT EXISTS appointment_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_contacts_follow_up_at
  ON public.contacts(follow_up_at)
  WHERE follow_up_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_appointment_at
  ON public.contacts(appointment_at)
  WHERE appointment_at IS NOT NULL;

COMMENT ON COLUMN public.contacts.follow_up_at IS 'Optional follow-up datetime for the contact. Used by app follow-up activity views.';
COMMENT ON COLUMN public.contacts.appointment_at IS 'Optional appointment datetime for the contact. Used by app appointment views.';

COMMIT;
