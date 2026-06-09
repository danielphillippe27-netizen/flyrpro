ALTER TABLE public.dialler_leads
  ADD COLUMN IF NOT EXISTS email text;
