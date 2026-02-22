# Ontario gold sources → Supabase

The **Load S3 to Supabase** workflow reads from S3 prefix `gold-standard/canada/ontario/` and loads the **latest** `*_gold.ndjson` per `source_id` into `ref_buildings_gold` and `ref_addresses_gold`.

## Required S3 path per source

Each source must have a file at:

```
gold-standard/canada/ontario/<source_id>/<yyyymmdd>/<source_id>_gold.ndjson
```

- **source_id** = folder name (e.g. `york_buildings`, `toronto_addresses`).
- **yyyymmdd** = date folder (workflow uses the latest per source).
- File must be NDJSON with the [gold schema](#gold-schema) (EWKT geom, SRID=4326).

## Your Ontario source_ids (from your list)

| source_id | Loaded as | Table |
|-----------|-----------|--------|
| brampton_buildings | buildings | ref_buildings_gold |
| burlington_addresses | addresses | ref_addresses_gold |
| burlington_buildings | buildings | ref_buildings_gold |
| durham_addresses | addresses | ref_addresses_gold |
| durham_buildings | buildings | ref_buildings_gold |
| guelph_addresses | addresses | ref_addresses_gold |
| guelph_buildings | buildings | ref_buildings_gold |
| hamilton_addresses | addresses | ref_addresses_gold |
| hamilton_buildings | buildings | ref_buildings_gold |
| london_addresses | addresses | ref_addresses_gold |
| london_buildings | buildings | ref_buildings_gold |
| milton_addresses | addresses | ref_addresses_gold |
| milton_buildings | buildings | ref_buildings_gold |
| mississauga_buildings | buildings | ref_buildings_gold |
| niagara_addresses | addresses | ref_addresses_gold |
| niagara_buildings | buildings | ref_buildings_gold |
| ottawa_addresses | addresses | ref_addresses_gold |
| ottawa_buildings | buildings | ref_buildings_gold |
| peel_addresses | addresses | ref_addresses_gold |
| peel_caledon_buildings | buildings | ref_buildings_gold |
| toronto_addresses | addresses | ref_addresses_gold |
| toronto_buildings | buildings | ref_buildings_gold |
| waterloo_addresses | addresses | ref_addresses_gold |
| waterloo_buildings | buildings | ref_buildings_gold |
| york_addresses | addresses | ref_addresses_gold |
| york_buildings | buildings | ref_buildings_gold |

The workflow chooses **addresses** vs **buildings** by the key: if the key contains `"address"` it runs `load_addresses`, if it contains `"building"` it runs `load_buildings`.

## Steps to pump these into Supabase

1. **Produce gold NDJSON** for each source (if not already):
   - Same record shape as York: buildings need `external_id`, `geom` (EWKT `SRID=4326;...`), etc.; addresses need `street_number`, `street_name`, `geom`, etc.
   - Use municipal processors (e.g. one per region, like `03_process_york.py`) or a config-driven pipeline that outputs this schema.

2. **Upload each file to S3** at the path above. Example for one file:
   ```bash
   # From GOLD-SCRIPT dir, using the upload helper:
   python 04_upload_gold_to_s3.py york_buildings ./path/to/york_buildings_gold.ndjson
   ```
   Or with AWS CLI (replace date and bucket):
   ```bash
   aws s3 cp ./york_buildings_gold.ndjson s3://YOUR_BUCKET/gold-standard/canada/ontario/york_buildings/20260222/york_buildings_gold.ndjson
   ```

3. **Run the workflow**: GitHub → Actions → **Load S3 to Supabase** → Run workflow with **source**: `all` (and `dry_run: true` once to verify counts).

The workflow will pick the latest date folder per `source_id` and load into Supabase.

## Gold schema (reference)

- **Buildings**: `source_id`, `source_file`, `source_url`, `source_date`, `external_id` (required), `parcel_id`, `geom` (EWKT), `centroid` (EWKT), `area_sqm`, `height_m`, `floors`, `year_built`, `building_type`, `subtype`, `primary_address`, `primary_street_number`, `primary_street_name`.
- **Addresses**: `source_id`, `source_file`, `source_url`, `source_date`, `street_number`, `street_name`, `unit`, `city`, `zip`, `province`, `country`, `geom` (EWKT), `address_type`, `precision`.

Geometries: `geom` must be EWKT with SRID (e.g. `SRID=4326;POLYGON(...)` or `SRID=4326;MULTIPOLYGON(...)`). The loader normalizes Polygon → MultiPolygon for buildings.
