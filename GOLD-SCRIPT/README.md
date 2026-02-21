# GOLD-SCRIPTS — Municipal Data Pipeline

Production-ready scripts for ingesting municipal building footprints + civic address points into Supabase (PostGIS).

## Files

| File | Purpose | Where to Run |
|------|---------|--------------|
| `01_fix_schema.sql` | Drop duplicate indexes, add UPSERT constraints, SRID checks | Supabase SQL Editor |
| `.github/workflows/s3-to-supabase.yml` | Stream NDJSON from S3 → staging → UPSERT | GitHub Actions |
| `03_process_york.py` | Shapefile → clean NDJSON (EWKT SRID=4326) → S3 | Local machine |

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

**Note:** The loader loads the **latest date folder per source_id** so nightly cron doesn't reprocess old runs.

#### Option B: You have raw Shapefiles locally
```bash
pip install pyshp shapely pyproj boto3
python 03_process_york.py
```
