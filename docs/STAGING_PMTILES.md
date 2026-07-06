# Staging PMTiles Runbook

This rollout must stay on `codex/pmtiles-staging-switchover` until staging is verified. Do not run the PMTiles build against production Supabase or production geometry keys.

## Required Staging Env

Set these on the `flyr-pro` Vercel preview/staging branch and in local `.env.staging.local` when running scripts:

```bash
GEOMETRY_STAGE=staging
GEOMETRY_STAGE_PREFIX=staging
DIAMOND_GEOMETRY_BUCKET=...
CLOUDFRONT_GEOMETRY_BASE_URL=...
SUPABASE_URL=https://<staging-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_URL=https://<staging-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
APP_BASE_URL=https://staging.flyrpro.app
NEXT_PUBLIC_API_BASE_URL=https://staging.flyrpro.app
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=...
```

For smoke tests, also set either `STAGING_ACCESS_TOKEN` or `STAGING_TEST_EMAIL` and `STAGING_TEST_PASSWORD`.

## Build One Campaign

Use a campaign from the sanitized staging Supabase clone:

```bash
npm run diamond:build -- <stagingCampaignId> --dry-run --stage-prefix=staging
npm run diamond:build -- <stagingCampaignId> --stage-prefix=staging
```

The generated snapshot must publish under:

```text
staging/campaigns/<campaignId>/buildings.pmtiles
staging/campaigns/<campaignId>/buildings.json
staging/campaigns/<campaignId>/buildings.geojson.gz
```

## Verify The Contract

Run:

```bash
npm run staging:pmtiles:smoke -- <stagingCampaignId>
```

The smoke refuses the known production Supabase ref, requires `GEOMETRY_STAGE=staging` and `GEOMETRY_STAGE_PREFIX=staging`, then verifies:

- `/diamond-manifest` is ready and staged.
- `promote_ids.buildings` is `building_id`.
- address layers use `address_id`.
- `primary_state_layer` is `addresses`.
- `/map-bundle` still works and reports PMTiles-backed geometry.

Status, visits, leads, and assignments stay in Supabase/realtime. PMTiles contain static geometry only.
