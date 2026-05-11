BEGIN;

ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_provision_source_check;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_provision_source_check
  CHECK (provision_source IN ('gold', 'silver', 'lambda', 'bedrock_nz', 'bedrock_au', 'bedrock_ca', 'bedrock_us'));

COMMENT ON COLUMN public.campaigns.provision_source IS
'Resolved provisioning data source for the campaign: gold, silver, lambda, bedrock_nz, bedrock_au, bedrock_ca, or bedrock_us.';

COMMIT;
