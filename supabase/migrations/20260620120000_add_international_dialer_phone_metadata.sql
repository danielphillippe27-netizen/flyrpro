ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS phone_country_code text,
  ADD COLUMN IF NOT EXISTS phone_area_code text,
  ADD COLUMN IF NOT EXISTS phone_area_label text;

ALTER TABLE public.dialler_leads
  ADD COLUMN IF NOT EXISTS phone_e164 text,
  ADD COLUMN IF NOT EXISTS phone_country_code text,
  ADD COLUMN IF NOT EXISTS phone_area_code text,
  ADD COLUMN IF NOT EXISTS phone_area_label text;

CREATE INDEX IF NOT EXISTS idx_contacts_workspace_phone_area
  ON public.contacts(workspace_id, phone_country_code, phone_area_code)
  WHERE phone_country_code IS NOT NULL OR phone_area_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dialler_leads_workspace_user_phone_area
  ON public.dialler_leads(workspace_id, user_id, phone_country_code, phone_area_code, created_at)
  WHERE phone_country_code IS NOT NULL OR phone_area_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dialler_leads_phone_e164
  ON public.dialler_leads(phone_e164)
  WHERE phone_e164 IS NOT NULL;
