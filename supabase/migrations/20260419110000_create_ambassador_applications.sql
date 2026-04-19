CREATE TABLE IF NOT EXISTS public.ambassador_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  full_name text NOT NULL,
  email text NOT NULL,
  phone text,
  city text,
  primary_niche text NOT NULL,
  primary_platform text NOT NULL,
  audience_size text,
  instagram_handle text,
  tiktok_handle text,
  youtube_handle text,
  website_url text,
  audience_summary text,
  why_flyr text NOT NULL,
  promotion_plan text,
  status text NOT NULL DEFAULT 'applied'
    CHECK (status IN ('applied', 'approved', 'rejected', 'paused')),
  review_notes text,
  approved_at timestamptz,
  rejected_at timestamptz,
  stripe_connect_account_id text,
  stripe_onboarding_completed boolean NOT NULL DEFAULT false,
  stripe_details_submitted boolean NOT NULL DEFAULT false,
  stripe_charges_enabled boolean NOT NULL DEFAULT false,
  stripe_payouts_enabled boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS ambassador_applications_created_at_idx
  ON public.ambassador_applications (created_at DESC);

CREATE INDEX IF NOT EXISTS ambassador_applications_status_idx
  ON public.ambassador_applications (status, created_at DESC);

CREATE INDEX IF NOT EXISTS ambassador_applications_email_lower_idx
  ON public.ambassador_applications ((lower(email)));

ALTER TABLE public.ambassador_applications ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.ambassador_applications_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ambassador_applications_set_updated_at
  ON public.ambassador_applications;
CREATE TRIGGER ambassador_applications_set_updated_at
BEFORE UPDATE ON public.ambassador_applications
FOR EACH ROW EXECUTE FUNCTION public.ambassador_applications_set_updated_at();
