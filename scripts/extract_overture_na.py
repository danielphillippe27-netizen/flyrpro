#!/usr/bin/env python3
"""
Overture North American Extractor - Production Pipeline

Extracts Buildings, Roads, and Divisions from Overture into region-partitioned Parquet files.

Tiling Strategy:
- Buildings: 0.25° tiles (centroid-based) - High granularity for dense urban areas
- Roads: 1.0° tiles (centroid-based) - Larger tiles to prevent "broken road" segments
- Divisions: No tiling - Single divisions.parquet per region

Usage:
    # Full North American extraction (6+ hours)
    AWS_PROFILE=deploy python3 extract_overture_na.py \
        --ssd-path "/Volumes/Untitled 2/na_extract.db" \
        --release 2026-01-21.0
    
    # Dry-run Ontario only
    AWS_PROFILE=deploy python3 extract_overture_na.py \
        --regions ON \
        --dry-run
    
    # Extract only buildings for specific states
    AWS_PROFILE=deploy python3 extract_overture_na.py \
        --themes buildings \
        --regions NY CA TX FL
"""

import argparse
import json
import math
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import duckdb


# =============================================================================
# Configuration
# =============================================================================

DEFAULT_RELEASE = "2026-01-21.0"
DEFAULT_OUT_BUCKET = "flyr-pro-addresses-2025"
DEFAULT_SSD_PATH = "/Volumes/Untitled 2/na_extract.db"

# Thematic tiling configuration
TILE_CONFIG = {
    "buildings": {"tile_deg": 0.25, "partition": True},
    "roads": {"tile_deg": 1.0, "partition": True},
    "divisions": {"tile_deg": None, "partition": False}  # No tiling
}

# Overture themes
THEMES = {
    "buildings": {
        "path": "theme=buildings/type=building/*",
        "columns": """
            id as gers_id,
            geometry as geometry_wkb,
            bbox.xmin as xmin,
            bbox.xmax as xmax,
            bbox.ymin as ymin,
            bbox.ymax as ymax,
            (bbox.xmin + bbox.xmax) / 2.0 as cx,
            (bbox.ymin + bbox.ymax) / 2.0 as cy,
            height,
            names.primary as name
        """
    },
    "roads": {
        "path": "theme=transportation/type=segment/*",
        "columns": """
            id as gers_id,
            geometry as geometry_wkb,
            bbox.xmin as xmin,
            bbox.xmax as xmax,
            bbox.ymin as ymin,
            bbox.ymax as ymax,
            (bbox.xmin + bbox.xmax) / 2.0 as cx,
            (bbox.ymin + bbox.ymax) / 2.0 as cy,
            NULL as height,
            subtype as road_type
        """
    },
    "divisions": {
        "path": "theme=divisions/type=division_area/*",
        "columns": """
            id as gers_id,
            geometry as geometry_wkb,
            bbox.xmin as xmin,
            bbox.xmax as xmax,
            bbox.ymin as ymin,
            bbox.ymax as ymax,
            (bbox.xmin + bbox.xmax) / 2.0 as cx,
            (bbox.ymin + bbox.ymax) / 2.0 as cy,
            NULL as height,
            names.primary as name
        """
    }
}

ROW_GROUP_SIZE = 100000


def log(msg: str, level: str = "INFO"):
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] [{level}] {msg}", flush=True)


def load_regions(regions_file: Optional[str] = None, region_codes: Optional[List[str]] = None) -> List[Dict]:
    """Load regions from JSON."""
    if regions_file is None:
        regions_file = Path(__file__).parent / "regions.json"
    
    with open(regions_file, "r") as f:
        regions = json.load(f)
    
    if region_codes:
        region_codes = [r.upper() for r in region_codes]
        regions = [r for r in regions if r["code"] in region_codes]
    
    log(f"Loaded {len(regions)} regions")
    return regions


def setup_duckdb(ssd_path: str) -> duckdb.DuckDBPyConnection:
    """Initialize DuckDB with SSD storage."""
    log(f"Initializing DuckDB: {ssd_path}")
    
    if os.path.exists(ssd_path):
        log(f"Removing existing DB")
        os.remove(ssd_path)
    
    os.makedirs(os.path.dirname(ssd_path) or ".", exist_ok=True)
    
    conn = duckdb.connect(database=ssd_path)
    conn.execute("INSTALL httpfs; LOAD httpfs;")
    conn.execute("INSTALL spatial; LOAD spatial;")
    conn.execute("INSTALL aws; LOAD aws;")
    
    log("DuckDB ready")
    return conn


def set_anonymous_overture(conn: duckdb.DuckDBPyConnection):
    """Set credentials for Overture public bucket (us-west-2)."""
    # Drop any existing secret first
    try:
        conn.execute("DROP SECRET IF EXISTS aws_s3;")
    except:
        pass
    conn.execute("SET s3_region='us-west-2';")
    conn.execute("SET s3_access_key_id='';")
    conn.execute("SET s3_secret_access_key='';")
    conn.execute("SET s3_session_token='';")


def set_authenticated_output(conn: duckdb.DuckDBPyConnection, bucket: str):
    """Set credentials for private output bucket."""
    try:
        result = subprocess.run(
            ["aws", "s3api", "get-bucket-location", "--bucket", bucket],
            capture_output=True, text=True, timeout=30
        )
        region = json.loads(result.stdout).get("LocationConstraint") or "us-east-1"
    except:
        region = "us-east-2"
    
    conn.execute(f"SET s3_region='{region}';")
    conn.execute("""
        CREATE OR REPLACE SECRET aws_s3 (TYPE S3, PROVIDER CREDENTIAL_CHAIN);
    """)


def extract_theme_region(
    conn: duckdb.DuckDBPyConnection,
    theme_name: str,
    region: Dict,
    release: str,
    out_bucket: str,
    dry_run: bool,
    ssd_path: str
) -> Dict:
    """
    Extract one theme for one region.
    
    Strategy:
    1. Anonymous read from Overture (us-west-2) -> SSD temp table
    2. Compute tiles based on theme config
    3. Authenticated write to S3 (us-east-2)
    """
    region_code = region["code"]
    bbox = region["bbox"]
    minx, miny, maxx, maxy = bbox
    
    theme_config = THEMES[theme_name]
    tile_config = TILE_CONFIG[theme_name]
    tile_deg = tile_config["tile_deg"]
    use_partition = tile_config["partition"]
    
    log(f"{'[DRY RUN] ' if dry_run else ''}{theme_name}: {region['name']} ({region_code})")
    
    overture_path = f"s3://overturemaps-us-west-2/release/{release}/{theme_config['path']}"
    
    start_time = time.time()
    
    # Step 1: Read from Overture (anonymous) - reset credentials before each read
    set_anonymous_overture(conn)
    
    # Build query with optional tile computation
    if use_partition and tile_deg:
        query = f"""
            SELECT 
                {theme_config['columns']},
                CAST(FLOOR(((bbox.xmin + bbox.xmax) / 2.0 + 180.0) / {tile_deg}) AS INTEGER) as tile_x,
                CAST(FLOOR(((bbox.ymin + bbox.ymax) / 2.0 + 90.0) / {tile_deg}) AS INTEGER) as tile_y
            FROM read_parquet('{overture_path}', hive_partitioning=1)
            WHERE bbox.xmin <= {maxx} AND bbox.xmax >= {minx}
              AND bbox.ymin <= {maxy} AND bbox.ymax >= {miny}
        """
    else:
        # Divisions - no tile columns
        query = f"""
            SELECT {theme_config['columns']}
            FROM read_parquet('{overture_path}', hive_partitioning=1)
            WHERE bbox.xmin <= {maxx} AND bbox.xmax >= {minx}
              AND bbox.ymin <= {maxy} AND bbox.ymax >= {miny}
        """
    
    if dry_run:
        count = conn.execute(f"SELECT COUNT(*) FROM ({query})").fetchone()[0]
        log(f"  [DRY RUN] ~{count:,} rows")
        return {"region": region_code, "theme": theme_name, "dry_run": True, "estimated": count}
    
    # Materialize to temp table
    log(f"  Reading from Overture...")
    conn.execute(f"CREATE OR REPLACE TEMP TABLE raw_data AS {query}")
    
    count = conn.execute("SELECT COUNT(*) FROM raw_data").fetchone()[0]
    if count == 0:
        log(f"  No data found")
        conn.execute("DROP TABLE IF EXISTS raw_data")
        return {"region": region_code, "theme": theme_name, "rows": 0, "time": 0}
    
    log(f"  Read {count:,} rows")
    
    # Export to local Parquet on SSD (not /tmp which may be on root volume)
    ssd_temp_dir = os.path.dirname(ssd_path) or "/tmp"
    local_file = f"{ssd_temp_dir}/{theme_name}_{region_code.lower()}.parquet"
    order_by = "tile_y, tile_x, gers_id" if use_partition else "gers_id"
    conn.execute(f"""
        COPY (SELECT * FROM raw_data ORDER BY {order_by})
        TO '{local_file}' (FORMAT PARQUET, ROW_GROUP_SIZE {ROW_GROUP_SIZE})
    """)
    conn.execute("DROP TABLE raw_data")
    
    # Step 2: Write to S3 (authenticated)
    set_authenticated_output(conn, out_bucket)
    
    if use_partition:
        output_path = f"s3://{out_bucket}/overture_extracts/{theme_name}/release={release}/region={region_code}"
        log(f"  Writing {tile_deg}° tiles to S3...")
        conn.execute(f"""
            COPY (SELECT * FROM read_parquet('{local_file}'))
            TO '{output_path}/' (
                FORMAT PARQUET,
                PARTITION_BY (tile_y, tile_x),
                OVERWRITE_OR_IGNORE 1,
                ROW_GROUP_SIZE {ROW_GROUP_SIZE},
                FILENAME_PATTERN 'part_{{uuid}}'
            )
        """)
    else:
        # Divisions - single file
        output_path = f"s3://{out_bucket}/overture_extracts/{theme_name}/release={release}/region={region_code}/divisions.parquet"
        log(f"  Writing single file to S3...")
        conn.execute(f"""
            COPY (SELECT * FROM read_parquet('{local_file}'))
            TO '{output_path}' (FORMAT PARQUET, ROW_GROUP_SIZE {ROW_GROUP_SIZE})
        """)
    
    if os.path.exists(local_file):
        os.remove(local_file)
        log(f"  Cleaned up {local_file}")
    
    elapsed = time.time() - start_time
    log(f"  ✓ Done: {count:,} rows in {elapsed:.1f}s")
    
    return {"region": region_code, "theme": theme_name, "rows": count, "time": elapsed}


def main():
    parser = argparse.ArgumentParser(description="Overture North American Extractor")
    parser.add_argument("--release", default=DEFAULT_RELEASE)
    parser.add_argument("--out-bucket", default=DEFAULT_OUT_BUCKET)
    parser.add_argument("--ssd-path", default=DEFAULT_SSD_PATH)
    parser.add_argument("--themes", nargs="+", default=["buildings", "roads", "divisions"])
    parser.add_argument("--regions", nargs="+", default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    
    log("=" * 70)
    log("NORTH AMERICAN OVERTURE EXTRACTION")
    log("=" * 70)
    log(f"Release: {args.release}")
    log(f"SSD: {args.ssd_path}")
    log(f"Output: s3://{args.out_bucket}")
    log(f"Themes: {', '.join(args.themes)}")
    log("Tiling: Buildings=0.25°, Roads=1.0°, Divisions=None")
    log("=" * 70)
    
    regions = load_regions(region_codes=args.regions)
    conn = setup_duckdb(args.ssd_path)
    
    results = []
    total_start = time.time()
    
    for theme in args.themes:
        if theme not in THEMES:
            continue
        
        log("")
        log(f"🚀 THEME: {theme.upper()}")
        
        for i, region in enumerate(regions, 1):
            log(f"[{i}/{len(regions)}] {region['code']}")
            try:
                result = extract_theme_region(conn, theme, region, args.release, args.out_bucket, args.dry_run, args.ssd_path)
                results.append(result)
            except Exception as e:
                log(f"  ERROR: {e}", "ERROR")
                results.append({"region": region["code"], "theme": theme, "error": str(e)})
    
    # Summary
    total_time = time.time() - total_start
    
    log("")
    log("=" * 70)
    log("SUMMARY")
    log("=" * 70)
    
    for theme in args.themes:
        theme_results = [r for r in results if r.get("theme") == theme]
        total_rows = sum(r.get("rows", 0) for r in theme_results)
        errors = len([r for r in theme_results if "error" in r])
        log(f"{theme}: {total_rows:,} rows, {errors} errors")
    
    log(f"\nTotal time: {total_time/60:.1f} minutes")
    
    # Cleanup
    conn.close()
    if os.path.exists(args.ssd_path):
        os.remove(args.ssd_path)
        log(f"Cleaned up SSD")
    
    errors = [r for r in results if "error" in r]
    if errors:
        log(f"\n⚠️ {len(errors)} errors occurred")
        sys.exit(1)
    log("\n✅ Complete!")


if __name__ == "__main__":
    main()
