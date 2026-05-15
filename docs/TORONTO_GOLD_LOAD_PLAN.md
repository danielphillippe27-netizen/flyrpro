# Toronto Gold Data Load — Action Plan

## Goal
Load Toronto gold-standard addresses and buildings from S3 into Supabase tables `ref_addresses_gold` and `ref_buildings_gold` so campaigns can use Toronto data. Source IDs: `toronto_addresses`, `toronto_buildings`.

## What’s Done

1. **Loader script updated** (`scripts/load_gold_direct.ts`):
   - S3 paths: `gold-standard/canada/ontario/toronto/addresses.geojson` and `buildings.geojson` (matches ingest script).
   - Source IDs: `toronto_addresses`, `toronto_buildings`.
   - Field mappings support both standardized (ingest) and raw Toronto keys: `street_name`/`LF_NAME`, `street_num`/`HI_NUM`/`HI_NUM_NO`, `unit`/`SUITE`, `city`/`MUNICIPALITY`, `GlobalID`/`OBJECTID`/`id`, `ShapeSTArea`/`area`.
   - Env: loads `.env.local` first (then `.env`) for AWS and DB credentials.
   - AWS region default: `us-east-2` (bucket requirement).
   - Parallel batch inserts (10 workers, 1000 rows/batch) for speed.

2. **Verified**: S3 download works — 428k+ building features download successfully. Load failed only because DB connection went to localhost instead of Supabase.

## What’s Left

1. **Set `DATABASE_URL` in `.env.local`** to the Supabase **pooler** URL (Transaction mode, port 6543), e.g.:
   ```bash
   DATABASE_URL="postgres://postgres.PROJECT_REF:PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres"
   ```
   Get the exact string from Supabase: Project Settings → Database → Connection string → “Transaction” pooler.

2. **Run the loader** (from project root):
   ```bash
   npx tsx scripts/load_gold_direct.ts
   ```
   It will:
   - Download Toronto addresses and buildings from S3.
   - Delete existing rows for `toronto_addresses` / `toronto_buildings` in the gold tables.
   - Insert all features in parallel. Expect ~2–3 minutes for 400k+ buildings and addresses.

3. **Success looks like**: Console shows “DONE! Loaded N rows” for both BUILDING and ADDRESS; Toronto appears in `ref_buildings_gold` and `ref_addresses_gold` with the source IDs above.

## Reference

- **S3 bucket**: `flyr-pro-addresses-2025` (region `us-east-2`).
- **Tables**: `ref_addresses_gold`, `ref_buildings_gold`.
- **Source IDs**: `toronto_buildings`, `toronto_addresses`.
- **Script**: `scripts/load_gold_direct.ts` (no CLI args; loads buildings then addresses).
