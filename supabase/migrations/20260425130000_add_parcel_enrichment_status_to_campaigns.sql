-- Track asynchronous parcel enrichment separately from core campaign provisioning.
ALTER TABLE public.campaigns
ADD COLUMN IF NOT EXISTS parcel_enrichment_status text DEFAULT 'not_started',
ADD COLUMN IF NOT EXISTS parcel_source_id text,
ADD COLUMN IF NOT EXISTS parcel_count integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS parcel_enriched_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS parcel_enrichment_error text;

ALTER TABLE public.campaigns
DROP CONSTRAINT IF EXISTS campaigns_parcel_enrichment_status_check;

ALTER TABLE public.campaigns
ADD CONSTRAINT campaigns_parcel_enrichment_status_check
CHECK (
  parcel_enrichment_status IN (
    'not_started',
    'queued',
    'processing',
    'ready',
    'failed',
    'skipped'
  )
);

CREATE INDEX IF NOT EXISTS idx_campaigns_parcel_enrichment_status
ON public.campaigns(parcel_enrichment_status)
WHERE parcel_enrichment_status IS NOT NULL;

COMMENT ON COLUMN public.campaigns.parcel_enrichment_status IS
'Status of parcel enrichment: not_started, queued, processing, ready, failed, or skipped.';

COMMENT ON COLUMN public.campaigns.parcel_source_id IS
'Resolved Ontario parcel source_id used for asynchronous parcel enrichment.';

COMMENT ON COLUMN public.campaigns.parcel_count IS
'Count of parcel polygons loaded into campaign_parcels for this campaign.';

COMMENT ON COLUMN public.campaigns.parcel_enriched_at IS
'Timestamp of the most recent successful parcel enrichment run.';

COMMENT ON COLUMN public.campaigns.parcel_enrichment_error IS
'Most recent parcel enrichment failure or skip reason.';
