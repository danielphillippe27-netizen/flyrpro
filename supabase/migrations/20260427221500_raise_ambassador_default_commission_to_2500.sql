ALTER TABLE public.ambassador_applications
  ALTER COLUMN commission_rate_bps SET DEFAULT 2500;

ALTER TABLE public.ambassador_referrals
  ALTER COLUMN commission_rate_bps SET DEFAULT 2500;
