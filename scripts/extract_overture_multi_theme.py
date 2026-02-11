#!/usr/bin/env python3
"""
Overture Multi-Theme Extractor - The "Big Play"

Extracts Buildings, Roads, and Divisions from global Overture data
into region/tile-partitioned Parquet files for efficient Lambda querying.

Uses SSD for temp storage to prevent memory issues during large extractions.

Usage:
    AWS_PROFILE=deploy python3 extract_overture_multi_theme.py \
        --release 2026-01-21.0 \
        --tile-deg 0.25 \
        --ssd-path "/Volumes/Untitled 2/overture_extract.db" \
        --themes buildings roads divisions \
        --regions ON NY CA TX
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
# Configuration & Constants
# =============================================================================

DEFAULT_RELEASE = "2026-01-21.0"
DEFAULT_TILE_DEG = 0.25
DEFAULT_OUT_BUCKET = "flyr-pro-addresses-2025"
DEFAULT_SSD_PATH = "/Volumes/Untitled 2/overture_extract.db"

# Target row group size for Parquet files
TARGET_ROW_GROUP_SIZE = 100000

# Overture themes configuration
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
        """,
        "extra_cols": "height, name"
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
            NULL as name
        """,
        "extra_cols": "height, name"
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
        """,
        "extra_cols": "height, name"
    }
}


# =============================================================================
# Logging
# =============================================================================

def log(msg: str, level: str = "INFO"):
    """Print timestamped log message."""
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] [{level}] {msg}", flush=True)


# =============================================================================
# Region Loading
# =============================================================================

def load_regions(regions_file: Optional[str] = None, region_codes: Optional[List[str]] = None) -> List[Dict]:
    """Load region definitions from JSON file."""
    if regions_file is None:
        script_dir = Path(__file__).parent
        regions_file = script_dir / "regions.json"
    
    with open(regions_file, "r") as f:
        regions = json.load(f)
    
    # Filter to requested regions if specified
    if region_codes:
        region_codes = [r.upper() for r in region_codes]
        regions = [r for r in regions if r["code"] in region_codes]
    
    log(f"Loaded {len(regions)} regions from {regions_file}")
    return regions


# =============================================================================
# Tile Math
# =============================================================================

def compute_tile_indices(lon: float, lat: float, tile_deg: float) -> Tuple[int, int]:
    """Compute tile_x, tile_y from longitude/latitude."""
    tile_x = math.floor((lon + 180.0) / tile_deg)
    tile_y = math.floor((lat + 90.0) / tile_deg)
    return tile_x, tile_y


# =============================================================================
# DuckDB Setup
# =============================================================================

def setup_duckdb(ssd_path: str) -> duckdb.DuckDBPyConnection:
    """
    Set up DuckDB with SSD-backed storage for large extractions.
    """
    log(f"Initializing DuckDB with SSD storage: {ssd_path}")
    
    # Remove existing DB to start fresh
    if os.path.exists(ssd_path):
        log(f"Removing existing database: {ssd_path}")
        os.remove(ssd_path)
    
    # Ensure parent directory exists
    os.makedirs(os.path.dirname(ssd_path), exist_ok=True)
    
    conn = duckdb.connect(database=ssd_path)
    
    # Install and load required extensions
    log("Installing extensions...")
    conn.execute("INSTALL httpfs;")
    conn.execute("LOAD httpfs;")
    conn.execute("INSTALL spatial;")
    conn.execute("LOAD spatial;")
    conn.execute("INSTALL aws;")
    conn.execute("LOAD aws;")
    
    log("DuckDB initialized with SSD storage")
    return conn


def get_bucket_region(bucket: str) -> str:
    """Detect S3 bucket region using AWS CLI."""
    try:
        result = subprocess.run(
            ["aws", "s3api", "get-bucket-location", "--bucket", bucket],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            data = json.loads(result.stdout)
            region = data.get("LocationConstraint") or "us-east-1"
            return region
    except Exception as e:
        log(f"Could not detect bucket region: {e}")
    return "us-east-2"


def set_anonymous_for_overture(conn: duckdb.DuckDBPyConnection):
    """Configure DuckDB for anonymous access to Overture (public bucket)."""
    conn.execute("SET s3_region='us-west-2';")
    conn.execute("SET s3_access_key_id='';")
    conn.execute("SET s3_secret_access_key='';")
    conn.execute("SET s3_session_token='';")


def set_credentials_for_output(conn: duckdb.DuckDBPyConnection, output_bucket: str):
    """Configure DuckDB for authenticated access to output bucket."""
    output_region = get_bucket_region(output_bucket)
    conn.execute(f"SET s3_region='{output_region}';")
    
    # Use credential chain
    conn.execute("""
        CREATE OR REPLACE SECRET aws_s3 (
            TYPE S3,
            PROVIDER CREDENTIAL_CHAIN
        );
    """)


# =============================================================================
# Extraction Logic
# =============================================================================

def extract_theme_for_region(
    conn: duckdb.DuckDBPyConnection,
    theme_name: str,
    theme_config: Dict,
    region: Dict,
    release: str,
    tile_deg: float,
    out_bucket: str,
    dry_run: bool = False
) -> Dict:
    """
    Extract a single theme for a single region.
    
    Strategy:
    1. Set anonymous credentials for Overture (us-west-2)
    2. Read and filter data, compute tiles
    3. Export to local Parquet on SSD
    4. Set IAM credentials for output bucket (us-east-2)
    5. Copy partitioned data to S3
    """
    region_code = region["code"]
    region_name = region["name"]
    bbox = region["bbox"]  # [minx, miny, maxx, maxy]
    minx, miny, maxx, maxy = bbox
    
    log(f"{'[DRY RUN] ' if dry_run else ''}{theme_name.upper()}: {region_name} ({region_code})")
    
    # Build source path
    overture_path = f"s3://overturemaps-us-west-2/release/{release}/{theme_config['path']}"
    output_base = f"s3://{out_bucket}/overture_extracts/{theme_name}/release={release}/region={region_code}"
    
    start_time = time.time()
    
    # Step 1: Set anonymous credentials for Overture read
    set_anonymous_for_overture(conn)
    
    # Build extraction query with tile computation
    extraction_sql = f"""
        SELECT 
            {theme_config['columns']},
            CAST(FLOOR(((bbox.xmin + bbox.xmax) / 2.0 + 180.0) / {tile_deg}) AS INTEGER) as tile_x,
            CAST(FLOOR(((bbox.ymin + bbox.ymax) / 2.0 + 90.0) / {tile_deg}) AS INTEGER) as tile_y
        FROM read_parquet('{overture_path}', hive_partitioning=1)
        WHERE bbox.xmin <= {maxx} AND bbox.xmax >= {minx}
          AND bbox.ymin <= {maxy} AND bbox.ymax >= {miny}
    """
    
    if dry_run:
        count_sql = f"SELECT COUNT(*) FROM ({extraction_sql})"
        result = conn.execute(count_sql).fetchone()
        count = result[0] if result else 0
        log(f"  [DRY RUN] Would extract ~{count:,} {theme_name}")
        return {
            "region": region_code,
            "theme": theme_name,
            "dry_run": True,
            "estimated_rows": count
        }
    
    # Create temp table with filtered data
    log(f"  Reading from Overture...")
    conn.execute(f"CREATE OR REPLACE TEMP TABLE raw_data AS {extraction_sql}")
    
    # Get row count
    count_result = conn.execute("SELECT COUNT(*) FROM raw_data").fetchone()
    row_count = count_result[0] if count_result else 0
    
    if row_count == 0:
        log(f"  No {theme_name} found for {region_code}, skipping")
        conn.execute("DROP TABLE IF EXISTS raw_data")
        return {
            "region": region_code,
            "theme": theme_name,
            "rows_written": 0,
            "tiles_created": 0,
            "elapsed_seconds": time.time() - start_time
        }
    
    log(f"  Filtered {row_count:,} {theme_name}")
    
    # Step 2: Export to local Parquet on SSD
    local_parquet = f"/tmp/extract_{theme_name}_{region_code.lower()}.parquet"
    log(f"  Exporting to local Parquet...")
    
    export_sql = f"""
        COPY (SELECT * FROM raw_data ORDER BY tile_y, tile_x, gers_id)
        TO '{local_parquet}' (FORMAT PARQUET, ROW_GROUP_SIZE {TARGET_ROW_GROUP_SIZE})
    """
    conn.execute(export_sql)
    log(f"  Exported to {local_parquet}")
    
    # Drop temp table to free memory
    conn.execute("DROP TABLE raw_data")
    
    # Step 3: Set credentials for output bucket
    set_credentials_for_output(conn, out_bucket)
    
    # Step 4: Copy partitioned data to S3
    log(f"  Writing partitioned data to S3...")
    copy_sql = f"""
        COPY (SELECT * FROM read_parquet('{local_parquet}'))
        TO '{output_base}/' (
            FORMAT PARQUET,
            PARTITION_BY (tile_y, tile_x),
            OVERWRITE_OR_IGNORE 1,
            ROW_GROUP_SIZE {TARGET_ROW_GROUP_SIZE},
            FILENAME_PATTERN 'part_{{uuid}}'
        )
    """
    conn.execute(copy_sql)
    
    # Clean up local file
    if os.path.exists(local_parquet):
        os.remove(local_parquet)
    
    elapsed = time.time() - start_time
    log(f"  ✓ Wrote {row_count:,} {theme_name} in {elapsed:.1f}s")
    
    return {
        "region": region_code,
        "theme": theme_name,
        "rows_written": row_count,
        "elapsed_seconds": elapsed
    }


# =============================================================================
# Main Entry Point
# =============================================================================

def parse_args():
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Extract Overture buildings, roads, and divisions by region"
    )
    
    parser.add_argument(
        "--release",
        type=str,
        default=os.environ.get("OVERTURE_RELEASE", DEFAULT_RELEASE),
        help=f"Overture release version (default: {DEFAULT_RELEASE})"
    )
    
    parser.add_argument(
        "--tile-deg",
        type=float,
        default=float(os.environ.get("TILE_DEG", str(DEFAULT_TILE_DEG))),
        help=f"Tile size in degrees (default: {DEFAULT_TILE_DEG})"
    )
    
    parser.add_argument(
        "--out-bucket",
        type=str,
        default=os.environ.get("OUT_BUCKET", DEFAULT_OUT_BUCKET),
        help=f"Output S3 bucket (default: {DEFAULT_OUT_BUCKET})"
    )
    
    parser.add_argument(
        "--ssd-path",
        type=str,
        default=os.environ.get("SSD_PATH", DEFAULT_SSD_PATH),
        help=f"Path to SSD for temp database (default: {DEFAULT_SSD_PATH})"
    )
    
    parser.add_argument(
        "--themes",
        nargs="+",
        choices=["buildings", "roads", "divisions", "all"],
        default=["all"],
        help="Themes to extract (default: all)"
    )
    
    parser.add_argument(
        "--regions",
        nargs="+",
        default=None,
        help="Region codes to extract (default: all in regions.json)"
    )
    
    parser.add_argument(
        "--regions-file",
        type=str,
        default=None,
        help="Path to regions.json file"
    )
    
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only count rows, don't write to S3"
    )
    
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Skip regions that already have extracts in S3"
    )
    
    return parser.parse_args()


def check_existing_extract(bucket: str, theme: str, release: str, region_code: str) -> bool:
    """Check if extract already exists for region/theme."""
    path = f"s3://{bucket}/overture_extracts/{theme}/release={release}/region={region_code}/"
    try:
        result = subprocess.run(
            ["aws", "s3", "ls", path],
            capture_output=True, text=True, timeout=30
        )
        return result.returncode == 0 and len(result.stdout.strip()) > 0
    except Exception:
        return False


def main():
    """Main entry point."""
    args = parse_args()
    
    # Determine themes to process
    if "all" in args.themes:
        themes_to_process = ["buildings", "roads", "divisions"]
    else:
        themes_to_process = args.themes
    
    log("=" * 70)
    log("OVERTURE MULTI-THEME EXTRACTOR - THE BIG PLAY")
    log("=" * 70)
    log(f"Release: {args.release}")
    log(f"Tile size: {args.tile_deg} degrees")
    log(f"Output: s3://{args.out_bucket}/overture_extracts/")
    log(f"SSD: {args.ssd_path}")
    log(f"Themes: {', '.join(themes_to_process)}")
    log(f"Dry run: {args.dry_run}")
    log("=" * 70)
    
    # Load regions
    regions = load_regions(args.regions_file, args.regions)
    
    # Initialize DuckDB with SSD storage
    conn = setup_duckdb(args.ssd_path)
    
    # Process each theme
    all_results = []
    total_start = time.time()
    
    for theme_name in themes_to_process:
        if theme_name not in THEMES:
            log(f"Unknown theme: {theme_name}, skipping", "WARN")
            continue
        
        theme_config = THEMES[theme_name]
        
        log("")
        log("=" * 70)
        log(f"🚀 PROCESSING THEME: {theme_name.upper()}")
        log("=" * 70)
        
        for i, region in enumerate(regions, 1):
            region_code = region["code"]
            log(f"\n[{i}/{len(regions)}] {theme_name}: {region['name']} ({region_code})")
            
            # Check for existing extract
            if args.skip_existing and not args.dry_run:
                if check_existing_extract(args.out_bucket, theme_name, args.release, region_code):
                    log(f"  Skipping {region_code} - extract already exists")
                    all_results.append({
                        "region": region_code,
                        "theme": theme_name,
                        "skipped": True,
                        "reason": "exists"
                    })
                    continue
            
            try:
                result = extract_theme_for_region(
                    conn=conn,
                    theme_name=theme_name,
                    theme_config=theme_config,
                    region=region,
                    release=args.release,
                    tile_deg=args.tile_deg,
                    out_bucket=args.out_bucket,
                    dry_run=args.dry_run
                )
                all_results.append(result)
            except Exception as e:
                log(f"  ERROR: {e}", "ERROR")
                all_results.append({
                    "region": region_code,
                    "theme": theme_name,
                    "error": str(e)
                })
                # Continue with next region
    
    # Final summary
    total_elapsed = time.time() - total_start
    
    log("")
    log("=" * 70)
    log("EXTRACTION COMPLETE - SUMMARY")
    log("=" * 70)
    
    # Group results by theme
    for theme_name in themes_to_process:
        theme_results = [r for r in all_results if r.get("theme") == theme_name]
        total_rows = sum(r.get("rows_written", 0) for r in theme_results)
        errors = [r for r in theme_results if "error" in r]
        skipped = [r for r in theme_results if r.get("skipped")]
        dry_runs = [r for r in theme_results if r.get("dry_run")]
        
        log(f"\n{theme_name.upper()}:")
        log(f"  Regions processed: {len(theme_results) - len(errors) - len(skipped)}")
        log(f"  Total rows: {total_rows:,}")
        log(f"  Skipped: {len(skipped)}")
        log(f"  Errors: {len(errors)}")
        if dry_runs:
            estimated_total = sum(r.get("estimated_rows", 0) for r in dry_runs)
            log(f"  Dry-run estimates: {estimated_total:,}")
    
    log(f"\nTotal time: {total_elapsed:.1f}s ({total_elapsed/60:.1f} minutes)")
    log("=" * 70)
    
    # Close DuckDB connection
    conn.close()
    
    # Clean up SSD file
    if os.path.exists(args.ssd_path):
        log(f"Cleaning up SSD database: {args.ssd_path}")
        os.remove(args.ssd_path)
    
    # Check for errors
    errors = [r for r in all_results if "error" in r]
    if errors:
        log(f"\n⚠️  {len(errors)} errors occurred during extraction")
        sys.exit(1)
    else:
        log("\n✅ All extractions completed successfully!")


if __name__ == "__main__":
    main()
