ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_provision_source_check;

UPDATE public.campaigns
SET provision_source = NULL
WHERE provision_source IN ('gold', 'silver', 'lambda');

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_provision_source_check
  CHECK (
    provision_source IS NULL
    OR provision_source IN ('diamond', 'bedrock_nz', 'bedrock_au', 'bedrock_ca', 'bedrock_us', 'bedrock_za')
  );

COMMENT ON COLUMN public.campaigns.provision_source IS
'Resolved campaign creation source. New provisioning only uses Diamond first, then Bedrock S3 folders.';
