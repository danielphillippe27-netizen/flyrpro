BEGIN;

UPDATE public.prospect_industries
SET
  name = 'Real estate',
  default_terms = '["real estate agents","real estate brokerage","realtor","real estate agent","real estate team","realtor team","real estate group"]'::jsonb,
  updated_at = now()
WHERE slug = 'real-estate-teams';

COMMIT;
