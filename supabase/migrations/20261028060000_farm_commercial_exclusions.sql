CREATE TABLE IF NOT EXISTS public.farm_commercial_exclusions (
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  address_id uuid NOT NULL,
  address_data jsonb NOT NULL,
  places jsonb NOT NULL,
  restored_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (farm_id, address_id)
);
ALTER TABLE public.farm_commercial_exclusions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.farm_commercial_exclusions FROM anon, authenticated;
GRANT ALL ON public.farm_commercial_exclusions TO service_role;
