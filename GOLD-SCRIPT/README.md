# GOLD-SCRIPTS — Municipal Data Pipeline

Production-ready scripts for ingesting municipal building footprints + civic address points into Supabase (PostGIS).

## Files

| File | Purpose | Where to Run |
|------|---------|--------------|
| `01_fix_schema.sql` | Drop duplicate indexes, add UPSERT constraints, SRID checks | Supabase SQL Editor |
| `01b_dedupe_addresses.sql` | Remove duplicate address rows (so unique constraint can be added) | **Direct** DB connection (psql, etc.) – SQL Editor times out |
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

**Note:** The loader reads from S3 prefix `gold-standard/canada/ontario/` and loads the **latest date folder per source_id** so nightly cron doesn't reprocess old runs.

#### Option B: You have raw Shapefiles locally
```bash
pip install pyshp shapely pyproj boto3
python 03_process_york.py
```

---

## Notes (for this project)

- **GitHub Actions + Supabase:** Use the **Shared Pooler** connection (IPv4 compatible). The direct host (`db.xxx.supabase.co`) and Dedicated Pooler are not IPv4 compatible from GitHub’s runners. In Supabase: Connect → Connection string → expand **“Using the Shared Pooler”** and use that host, port, and user.
- **Pooler user:** Must be `postgres.[project-ref]` (e.g. `postgres.kfnsnwqylsdsbgnwgxva`), not plain `postgres`.
- **S3 region:** S3 can be in any region (e.g. us-east-2 Ohio); the workflow runner talks to both S3 and Supabase independently. No need to match regions.
- **Workflow at repo root:** The copy in `.github/workflows/s3-to-supabase.yml` (repo root) is what Actions runs; the copy under `GOLD-SCRIPT/.github/workflows/` is for reference.
- **Address dedupe timeout:** If adding the address unique constraint fails with "Key is duplicated", run `01b_dedupe_addresses.sql` first. Run it via a **direct** Postgres connection (e.g. `psql "postgresql://postgres:PASSWORD@db.xxx.supabase.co:5432/postgres" -f 01b_dedupe_addresses.sql`). Supabase SQL Editor will timeout on large tables.
