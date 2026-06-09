ALTER TABLE public.dialler_leads
  ADD COLUMN IF NOT EXISTS follow_up_name text,
  ADD COLUMN IF NOT EXISTS follow_up_at timestamptz;
