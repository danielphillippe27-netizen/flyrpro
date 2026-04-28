-- Persist parcel enrichment diagnostics for easier debugging of source selection and filtering.
ALTER TABLE public.campaigns
ADD COLUMN IF NOT EXISTS parcel_enrichment_debug jsonb DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.campaigns.parcel_enrichment_debug IS
'Structured diagnostics for parcel enrichment runs, including source selection, chosen S3 key, filter counts, and relink outcomes.';
