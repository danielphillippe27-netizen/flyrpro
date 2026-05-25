CREATE TABLE IF NOT EXISTS public.salespeople (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  full_name text NOT NULL,
  email text NOT NULL,
  phone text,
  role text,
  territory text,
  referral_code text,
  commission_rate_bps integer NOT NULL DEFAULT 2500,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'inactive')),
  notes text,
  stripe_connect_account_id text,
  stripe_onboarding_completed boolean NOT NULL DEFAULT false,
  stripe_details_submitted boolean NOT NULL DEFAULT false,
  stripe_charges_enabled boolean NOT NULL DEFAULT false,
  stripe_payouts_enabled boolean NOT NULL DEFAULT false,
  approved_at timestamptz,
  paused_at timestamptz,
  inactive_at timestamptz,
  CONSTRAINT salespeople_commission_rate_bps_check
    CHECK (commission_rate_bps >= 1 AND commission_rate_bps <= 10000)
);

CREATE INDEX IF NOT EXISTS salespeople_created_at_idx
  ON public.salespeople (created_at DESC);

CREATE INDEX IF NOT EXISTS salespeople_status_idx
  ON public.salespeople (status, created_at DESC);

CREATE INDEX IF NOT EXISTS salespeople_email_lower_idx
  ON public.salespeople ((lower(email)));

CREATE UNIQUE INDEX IF NOT EXISTS salespeople_referral_code_lower_idx
  ON public.salespeople ((lower(referral_code)))
  WHERE referral_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS salespeople_stripe_connect_account_idx
  ON public.salespeople (stripe_connect_account_id)
  WHERE stripe_connect_account_id IS NOT NULL;

ALTER TABLE public.salespeople ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.salespeople_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS salespeople_set_updated_at
  ON public.salespeople;
CREATE TRIGGER salespeople_set_updated_at
BEFORE UPDATE ON public.salespeople
FOR EACH ROW EXECUTE FUNCTION public.salespeople_set_updated_at();
