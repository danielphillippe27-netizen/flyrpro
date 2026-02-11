-- Add tags column to contacts for lead categorization (comma-separated or array)
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS tags text;

COMMENT ON COLUMN public.contacts.tags IS 'Optional tags for the contact, e.g. comma-separated or stored as text.';
