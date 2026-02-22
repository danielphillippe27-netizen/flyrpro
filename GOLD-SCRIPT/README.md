# GOLD-SCRIPTS — Municipal Data Pipeline

Production-ready scripts for ingesting municipal building footprints + civic address points into Supabase (PostGIS).

## Files

| File | Purpose | Where to Run |
|------|---------|--------------|
| `01_fix_schema.sql` | Drop duplicate indexes, add UPSERT constraints, SRID checks | Supabase SQL Editor |
| `01b_dedupe_addresses.sql` | Remove duplicate address rows (so unique constraint can be added) | **Direct** DB connection (psql, etc.) – SQL Editor times out |
| `02_unzip_to_raw.py` | Unzip municipal .zip files (e.g. on SSD) into `raw/` layout | Local machine |
| `03_process_york.py` | Shapefile → clean NDJSON (EWKT SRID=4326) → S3 | Local machine |
| `04_upload_gold_to_s3.py` | Upload one gold NDJSON to the S3 path the workflow expects | Local machine |
| `ONTARIO_SOURCES.md` | List of Ontario source_ids and S3 paths for Supabase load | Reference |
| `.github/workflows/s3-to-supabase.yml` | Stream NDJSON from S3 → staging → UPSERT | GitHub Actions |
| `requirements.txt` | Python deps for processing (pyshp, shapely, pyproj, boto3) | `pip install -r requirements.txt` |

---

## Security (Read This)

- **Never commit secrets** to git.
- Store secrets in **GitHub Actions → Secrets**.
- If you suspect a secret was exposed, **rotate it immediately** (AWS keys + Supabase DB password).

---

## Quick Start

### Step 1 — Fix Schema (Supabase SQL Editor)
1. Supabase Dashboard → SQL Editor  
2. Run `01_fix_schema.sql`

This adds:
- named UPSERT constraints (buildings + addresses)
- SRID checks (must be EPSG:4326)
- optional manual linking function (not used automatically)

### Step 2 — Add GitHub Secrets
Repo → Settings → Secrets → Actions:

| Secret | Value |
|--------|-------|
| `POSTGRES_HOST` | your Supabase host |
| `POSTGRES_DB` | `postgres` |
| `POSTGRES_USER` | `postgres` |
| `POSTGRES_PASSWORD` | your DB password |
| `POSTGRES_PORT` | `5432` |
| `AWS_ACCESS_KEY_ID` | AWS key |
| `AWS_SECRET_ACCESS_KEY` | AWS secret |
| `AWS_REGION` | region (e.g., `us-east-2`) |
| `AWS_BUCKET_NAME` | bucket name |

### Step 3 — Load Data

#### Option A: Data already in S3
1. GitHub → Actions → "Load S3 to Supabase"
2. Run workflow:
   - `source`: `york_buildings` (or `all`)
   - `dry_run`: true first
3. Run again with `dry_run: false`

**Note:** The loader reads from S3 prefix `gold-standard/canada/ontario/` and loads the **latest date folder per source_id** so nightly cron doesn't reprocess old runs.

#### Option B: Raw shapefiles already extracted locally
```bash
pip install -r requirements.txt
python 03_process_york.py
```

#### Option C: Raw data in .zip files on SSD (unzip → clean → S3)
1. **Unzip** into the expected `raw/` layout (one folder per zip; folder name = zip name without `.zip`):
   ```bash
   pip install -r requirements.txt
   python 02_unzip_to_raw.py /path/on/ssd/York_buildings.zip /path/on/ssd/York_addresses.zip
   ```
   Use `--storage /Volumes/YourSSD/municipal_data` if your base path is not the default. Use `--dry-run` to see where files would go.

2. **Process and upload** (cleaning matches gold tables; output goes to S3):
   ```bash
   python 03_process_york.py
   ```
   If your .shp paths differ from York’s, pass explicit paths:
   ```bash
   python 03_process_york.py --storage /Volumes/YourSSD/municipal_data \
     --buildings-shp "/Volumes/YourSSD/municipal_data/raw/York_buildings/Building_Footprint/Building_Footprint.shp" \
     --addresses-shp "/Volumes/YourSSD/municipal_data/raw/York_addresses/Address_Point/Address_Point.shp"
   ```
   Use `--buildings-only` or `--addresses-only` to run one side.

3. **Load into Supabase**: run the GitHub Action “Load S3 to Supabase” (Option A above). It uses the latest `gold-standard/canada/ontario/<source_id>/<yyyymmdd>/` per source_id.

**S3 layout:** `gold-standard/canada/ontario/<source_id>/<yyyymmdd>/<source_id>_gold.ndjson`. The workflow loads files whose key contains `building` or `address` into `ref_buildings_gold` and `ref_addresses_gold` respectively (e.g. `york_buildings`, `york_addresses`).

#### Multiple Ontario sources (Brampton, Burlington, Durham, etc.)
See **`ONTARIO_SOURCES.md`** for the full list of source_ids and the exact S3 path each needs. For each source you must have a gold NDJSON at that path, then run the workflow with **source**: `all`. To upload a local NDJSON: `python 04_upload_gold_to_s3.py <source_id> <path/to/file_gold.ndjson>`.

---

## Notes (for this project)

- **GitHub Actions + Supabase:** Use the **Shared Pooler** connection (IPv4 compatible). The direct host (`db.xxx.supabase.co`) and Dedicated Pooler are not IPv4 compatible from GitHub’s runners. In Supabase: Connect → Connection string → expand **“Using the Shared Pooler”** and use that host, port, and user.
- **Pooler user:** Must be `postgres.[project-ref]` (e.g. `postgres.kfnsnwqylsdsbgnwgxva`), not plain `postgres`.
- **S3 region:** S3 can be in any region (e.g. us-east-2 Ohio); the workflow runner talks to both S3 and Supabase independently. No need to match regions.
- **Workflow at repo root:** The copy in `.github/workflows/s3-to-supabase.yml` (repo root) is what Actions runs; the copy under `GOLD-SCRIPT/.github/workflows/` is for reference.
- **Address dedupe timeout:** If adding the address unique constraint fails with "Key is duplicated", run `01b_dedupe_addresses.sql` first. Run it via a **direct** Postgres connection (e.g. `psql "postgresql://postgres:PASSWORD@db.xxx.supabase.co:5432/postgres" -f 01b_dedupe_addresses.sql`). Supabase SQL Editor will timeout on large tables.
