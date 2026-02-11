#!/usr/bin/env python3
"""
Extract Overture Buildings by Region - Production Batch Job

One-time/batch job to pre-extract buildings from global Overture dataset
into region/tile-partitioned Parquet files in a private S3 bucket.

Partitioning scheme:
  s3://<bucket>/overture_extracts/buildings/release=<RELEASE>/region=<CODE>/tile_y=<INT>/tile_x=<INT>/part-*.parquet

This allows Lambda to prune files efficiently by only scanning relevant tiles.
"""

import argparse
import json
import math
import os
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
DEFAULT_OUT_PREFIX = "overture_extracts/buildings"
DEFAULT_OVERTURE_BUCKET = "overturemaps-us-west-2"
DEFAULT_OVERTURE_REGION = "us-west-2"

# Target row group size for Parquet files (~128MB target part size)
TARGET_ROW_GROUP_SIZE = 100000

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

def load_regions(regions_file: Optional[str] = None) -> List[Dict]:
    """Load region definitions from JSON file."""
    if regions_file is None:
        # Look in same directory as script
        script_dir = Path(__file__).parent
        regions_file = script_dir / "regions.json"
    
    with open(regions_file, "r") as f:
        regions = json.load(f)
    
    log(f"Loaded {len(regions)} regions from {regions_file}")
    return regions


def get_region(regions: List[Dict], code: str) -> Optional[Dict]:
    """Get region by code."""
    for r in regions:
        if r["code"] == code.upper():
            return r
    return None


# =============================================================================
# Tile Math
# =============================================================================

def compute_tile_indices(lon: float, lat: float, tile_deg: float) -> Tuple[int, int]:
    """
    Compute tile_x, tile_y from longitude/latitude.
    
    tile_x = floor((lon + 180.0) / tile_deg)
    tile_y = floor((lat +  90.0) / tile_deg)
    """
    tile_x = math.floor((lon + 180.0) / tile_deg)
    tile_y = math.floor((lat + 90.0) / tile_deg)
    return tile_x, tile_y


def compute_tile_ranges_for_bbox(
    minx: float, miny: float, maxx: float, maxy: float, tile_deg: float
) -> Tuple[int, int, int, int]:
    """
    Compute tile index ranges that cover a given bbox.
    Returns (tile_x_min, tile_x_max, tile_y_min, tile_y_max)
    """
    tile_x_min, tile_y_min = compute_tile_indices(minx, miny, tile_deg)
    tile_x_max, tile_y_max = compute_tile_indices(maxx, maxy, tile_deg)
    return tile_x_min, tile_x_max, tile_y_min, tile_y_max


def estimate_tiles_for_region(region: Dict, tile_deg: float) -> int:
    """Estimate number of tiles needed for a region bbox."""
    bbox = region["bbox"]  # [minx, miny, maxx, maxy]
    tx_min, tx_max, ty_min, ty_max = compute_tile_ranges_for_bbox(
        bbox[0], bbox[1], bbox[2], bbox[3], tile_deg
    )
    # +1 because ranges are inclusive
    return (tx_max - tx_min + 1) * (ty_max - ty_min + 1)


# =============================================================================
# DuckDB Setup
# =============================================================================

def setup_duckdb(overture_region: str) -> duckdb.DuckDBPyConnection:
    """
    Set up DuckDB with required extensions.
    
    Note: Overture bucket is public and requires anonymous access.
    Output bucket uses IAM credential chain.
    """
    log("Initializing DuckDB...")
    
    conn = duckdb.connect(":memory:")
    
    # Install and load required extensions
    conn.execute("INSTALL httpfs;")
    conn.execute("LOAD httpfs;")
    conn.execute("INSTALL spatial;")
    conn.execute("LOAD spatial;")
    conn.execute("INSTALL aws;")
    conn.execute("LOAD aws;")
    
    # Configure S3 region for Overture
    conn.execute(f"SET s3_region='{overture_region}';")
    
    # Overture bucket is public - use anonymous access for reading
    log("Configuring anonymous S3 access for Overture (public bucket)...")
    conn.execute("SET s3_access_key_id='';")
    conn.execute("SET s3_secret_access_key='';")
    conn.execute("SET s3_session_token='';")
    
    log("DuckDB initialized with httpfs, spatial, and anonymous S3 access")
    return conn


def get_bucket_region(bucket: str) -> str:
    """Detect S3 bucket region using AWS CLI."""
    try:
        import subprocess
        result = subprocess.run(
            ["aws", "s3api", "get-bucket-location", "--bucket", bucket],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            import json
            data = json.loads(result.stdout)
            # LocationConstraint is null for us-east-1, otherwise the region
            region = data.get("LocationConstraint") or "us-east-1"
            return region
    except Exception as e:
        log(f"Could not detect bucket region: {e}")
    return "us-east-2"  # Default fallback


def setup_credentials_for_output(conn: duckdb.DuckDBPyConnection, output_bucket: str):
    """
    Configure AWS credentials for writing to private output bucket.
    Uses environment variables or IAM role for authentication.
    
    Note: We use SET commands directly instead of CREATE SECRET to avoid
    conflicts with the anonymous access needed for Overture reads.
    """
    log("Configuring AWS credentials for output bucket...")
    
    # Detect and set correct region for output bucket
    output_region = get_bucket_region(output_bucket)
    conn.execute(f"SET s3_region='{output_region}';")
    log(f"  Output bucket region: {output_region}")
    
    # Try to get credentials from boto3 (which uses the credential chain)
    try:
        import boto3
        session = boto3.Session()
        creds = session.get_credentials()
        if creds:
            frozen_creds = creds.get_frozen_credentials()
            if frozen_creds.access_key:
                conn.execute(f"SET s3_access_key_id='{frozen_creds.access_key}';")
                conn.execute(f"SET s3_secret_access_key='{frozen_creds.secret_key}';")
                if frozen_creds.token:
                    conn.execute(f"SET s3_session_token='{frozen_creds.token}';")
                log("  AWS credentials loaded via boto3 credential chain")
            else:
                log("  No AWS credentials found in chain, relying on instance metadata")
        else:
            log("  No AWS credentials found, relying on instance metadata/IAM role")
    except Exception as e:
        log(f"  Could not load explicit credentials: {e}")
        log("  Relying on IAM role/instance metadata")


# =============================================================================
# Extraction Logic
# =============================================================================

def build_overture_source_path(release: str, bucket: str) -> str:
    """Build S3 path to Overture buildings Parquet files."""
    return f"s3://{bucket}/release/{release}/theme=buildings/type=building/*"


def build_output_path(
    bucket: str, 
    prefix: str, 
    release: str, 
    region_code: str
) -> str:
    """Build S3 output path for partitioned extracts."""
    # Note: DuckDB PARTITION_BY will create tile_y=xxx/tile_x=yyy subdirectories
    return f"s3://{bucket}/{prefix}/release={release}/region={region_code}"


def extract_region_buildings(
    conn: duckdb.DuckDBPyConnection,
    region: Dict,
    release: str,
    tile_deg: float,
    out_bucket: str,
    out_prefix: str,
    overture_bucket: str,
    overture_region: str,
    dry_run: bool = False,
) -> Dict:
    """
    Extract buildings for a single region.
    
    Returns dict with extraction statistics.
    """
    region_code = region["code"]
    region_name = region["name"]
    bbox = region["bbox"]  # [minx, miny, maxx, maxy]
    minx, miny, maxx, maxy = bbox
    
    log(f"{'[DRY RUN] ' if dry_run else ''}Processing region: {region_name} ({region_code})")
    log(f"  BBOX: [{minx}, {miny}, {maxx}, {maxy}]")
    
    # Estimate tiles
    est_tiles = estimate_tiles_for_region(region, tile_deg)
    log(f"  Estimated tiles (at {tile_deg}°): ~{est_tiles}")
    
    start_time = time.time()
    
    # Build source and destination paths
    overture_path = build_overture_source_path(release, overture_bucket)
    output_base = build_output_path(out_bucket, out_prefix, release, region_code)
    
    log(f"  Source: {overture_path}")
    log(f"  Output: {output_base}/tile_y=*/tile_x=*")
    
    # Ensure we're using anonymous access and us-west-2 for Overture reads
    conn.execute("SET s3_region='us-west-2';")
    conn.execute("SET s3_access_key_id='';")
    conn.execute("SET s3_secret_access_key='';")
    conn.execute("SET s3_session_token='';")
    
    if dry_run:
        # Count rows that would be extracted
        count_sql = f"""
            SELECT COUNT(*) as cnt
            FROM read_parquet('{overture_path}', hive_partitioning=1)
            WHERE bbox.xmin <= {maxx} AND bbox.xmax >= {minx}
              AND bbox.ymin <= {maxy} AND bbox.ymax >= {miny}
        """
        log(f"  Dry-run count SQL: {count_sql[:200]}...")
        result = conn.execute(count_sql).fetchone()
        count = result[0] if result else 0
        log(f"  [DRY RUN] Would extract ~{count:,} buildings into ~{est_tiles} tiles")
        return {
            "region": region_code,
            "dry_run": True,
            "estimated_rows": count,
            "estimated_tiles": est_tiles,
        }
    
    # Compute tile indices for partitioning
    # We use centroid-based tiling for distribution
    tile_size = tile_deg
    
    # Build the extraction query with tile computation
    # Note: Overture bbox struct has: xmin, xmax, ymin, ymax
    extraction_sql = f"""
        WITH filtered AS (
            SELECT 
                id as gers_id,
                geometry as geometry_wkb,
                bbox.xmin as xmin,
                bbox.xmax as xmax,
                bbox.ymin as ymin,
                bbox.ymax as ymax,
                (bbox.xmin + bbox.xmax) / 2.0 as cx,
                (bbox.ymin + bbox.ymax) / 2.0 as cy,
                height,
                names
            FROM read_parquet('{overture_path}', hive_partitioning=1)
            WHERE bbox.xmin <= {maxx} AND bbox.xmax >= {minx}
              AND bbox.ymin <= {maxy} AND bbox.ymax >= {miny}
        ),
        with_tiles AS (
            SELECT 
                gers_id,
                geometry_wkb,
                xmin,
                xmax,
                ymin,
                ymax,
                cx,
                cy,
                height,
                names,
                CAST(FLOOR((cx + 180.0) / {tile_size}) AS INTEGER) as tile_x,
                CAST(FLOOR((cy + 90.0) / {tile_size}) AS INTEGER) as tile_y
            FROM filtered
        )
        SELECT * FROM with_tiles
    """
    
    # Create a temp view for the extraction
    view_name = f"extract_{region_code.lower()}"
    conn.execute(f"CREATE OR REPLACE TEMP VIEW {view_name} AS {extraction_sql}")
    
    # Get row count
    count_result = conn.execute(f"SELECT COUNT(*) FROM {view_name}").fetchone()
    row_count = count_result[0] if count_result else 0
    log(f"  Filtered {row_count:,} buildings intersecting region bbox")
    
    if row_count == 0:
        log(f"  No buildings found for {region_code}, skipping write")
        return {
            "region": region_code,
            "rows_written": 0,
            "tiles_created": 0,
            "elapsed_seconds": time.time() - start_time,
        }
    
    # Export to local Parquet first (avoids S3 region/credential conflicts)
    # Then upload to S3 with proper credentials
    local_parquet = f"/tmp/extract_{region_code.lower()}.parquet"
    log(f"  Exporting {row_count:,} rows to local Parquet...")
    
    export_sql = f"""
        COPY (
            SELECT 
                gers_id,
                geometry_wkb,
                xmin,
                xmax,
                ymin,
                ymax,
                cx,
                cy,
                height,
                names,
                tile_x,
                tile_y
            FROM {view_name}
            ORDER BY tile_y, tile_x, gers_id
        ) TO '{local_parquet}' (
            FORMAT PARQUET,
            ROW_GROUP_SIZE {TARGET_ROW_GROUP_SIZE}
        )
    """
    conn.execute(export_sql)
    log(f"  Exported to {local_parquet}")
    
    # Now switch credentials and read from local file to partitioned S3
    setup_credentials_for_output(conn, out_bucket)
    
    log(f"  Writing partitioned Parquet to S3...")
    log(f"  Output: {output_base}/tile_y=*/tile_x=*")
    
    copy_sql = f"""
        COPY (
            SELECT * FROM read_parquet('{local_parquet}')
        ) TO '{output_base}/' (
            FORMAT PARQUET,
            PARTITION_BY (tile_y, tile_x),
            OVERWRITE_OR_IGNORE 1,
            ROW_GROUP_SIZE {TARGET_ROW_GROUP_SIZE},
            FILENAME_PATTERN 'part_{{uuid}}'
        )
    """
    
    log(f"  Executing COPY to S3...")
    conn.execute(copy_sql)
    
    # Clean up local file
    import os
    if os.path.exists(local_parquet):
        os.remove(local_parquet)
        log(f"  Cleaned up local file")
    
    # Count actual tiles created by listing the S3 path
    # We query only the tile subdirectories to avoid hive partition mismatches
    try:
        tile_count_result = conn.execute(f"""
            SELECT COUNT(DISTINCT (tile_x::TEXT || ',' || tile_y::TEXT)) 
            FROM read_parquet('{output_base}/tile_y=*/*/*.parquet', hive_partitioning=1)
        """).fetchone()
        tile_count = tile_count_result[0] if tile_count_result else 0
    except Exception as e:
        log(f"  Warning: Could not count tiles from S3: {e}")
        tile_count = -1  # Unknown
    
    elapsed = time.time() - start_time
    log(f"  ✓ Wrote {row_count:,} buildings to {tile_count} tiles in {elapsed:.1f}s")
    
    return {
        "region": region_code,
        "rows_written": row_count,
        "tiles_created": tile_count,
        "elapsed_seconds": elapsed,
    }


# =============================================================================
# Main Entry Point
# =============================================================================

def parse_args():
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Extract Overture buildings by region into tile-partitioned Parquet"
    )
    
    parser.add_argument(
        "--region",
        type=str,
        default=None,
        help="Region code to extract (e.g., ON, QC, NY). Default: all regions in regions.json"
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
        "--out-prefix",
        type=str,
        default=os.environ.get("OUT_PREFIX", DEFAULT_OUT_PREFIX),
        help=f"Output S3 prefix (default: {DEFAULT_OUT_PREFIX})"
    )
    
    parser.add_argument(
        "--overture-bucket",
        type=str,
        default=os.environ.get("OVERTURE_BUCKET", DEFAULT_OVERTURE_BUCKET),
        help=f"Overture source bucket (default: {DEFAULT_OVERTURE_BUCKET})"
    )
    
    parser.add_argument(
        "--overture-region",
        type=str,
        default=os.environ.get("OVERTURE_REGION", DEFAULT_OVERTURE_REGION),
        help=f"Overture bucket region (default: {DEFAULT_OVERTURE_REGION})"
    )
    
    parser.add_argument(
        "--regions-file",
        type=str,
        default=None,
        help="Path to regions.json file (default: scripts/regions.json)"
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


def check_existing_extract(
    conn: duckdb.DuckDBPyConnection,
    bucket: str,
    prefix: str,
    release: str,
    region_code: str
) -> bool:
    """Check if extract already exists for region."""
    path = f"s3://{bucket}/{prefix}/release={release}/region={region_code}/"
    try:
        # Try to list the path - if it fails or is empty, no extract exists
        result = conn.execute(f"""
            SELECT COUNT(*) 
            FROM read_parquet('{path}**/*.parquet', hive_partitioning=1) 
            LIMIT 1
        """).fetchone()
        return result is not None and result[0] >= 0
    except Exception:
        return False


def main():
    """Main entry point."""
    args = parse_args()
    
    log("=" * 70)
    log("Overture Buildings Extractor by Region")
    log("=" * 70)
    log(f"Release: {args.release}")
    log(f"Tile size: {args.tile_deg} degrees")
    log(f"Output: s3://{args.out_bucket}/{args.out_prefix}")
    log(f"Dry run: {args.dry_run}")
    log("=" * 70)
    
    # Load regions
    regions = load_regions(args.regions_file)
    
    # Filter to requested region(s)
    if args.region:
        region = get_region(regions, args.region)
        if not region:
            log(f"ERROR: Region '{args.region}' not found in regions.json", "ERROR")
            sys.exit(1)
        regions = [region]
    
    log(f"Will process {len(regions)} region(s)")
    
    # Initialize DuckDB
    conn = setup_duckdb(args.overture_region)
    
    # Process each region
    results = []
    total_start = time.time()
    
    for i, region in enumerate(regions, 1):
        log(f"\n[{i}/{len(regions)}] Processing {region['name']} ({region['code']})")
        
        # Check for existing extract
        if args.skip_existing and not args.dry_run:
            if check_existing_extract(
                conn, args.out_bucket, args.out_prefix, 
                args.release, region["code"]
            ):
                log(f"  Skipping {region['code']} - extract already exists")
                results.append({
                    "region": region["code"],
                    "skipped": True,
                    "reason": "exists"
                })
                continue
        
        try:
            result = extract_region_buildings(
                conn=conn,
                region=region,
                release=args.release,
                tile_deg=args.tile_deg,
                out_bucket=args.out_bucket,
                out_prefix=args.out_prefix,
                overture_bucket=args.overture_bucket,
                overture_region=args.overture_region,
                dry_run=args.dry_run,
            )
            results.append(result)
        except Exception as e:
            log(f"  ERROR processing {region['code']}: {e}", "ERROR")
            results.append({
                "region": region["code"],
                "error": str(e)
            })
            # Continue with next region
    
    # Summary
    total_elapsed = time.time() - total_start
    log("\n" + "=" * 70)
    log("EXTRACTION SUMMARY")
    log("=" * 70)
    
    total_rows = sum(r.get("rows_written", 0) for r in results)
    total_tiles = sum(r.get("tiles_created", 0) for r in results)
    errors = [r for r in results if "error" in r]
    skipped = [r for r in results if r.get("skipped")]
    
    for r in results:
        region = r["region"]
        if "error" in r:
            log(f"  {region}: ERROR - {r['error']}", "ERROR")
        elif r.get("dry_run"):
            log(f"  {region}: DRY RUN - ~{r.get('estimated_rows', 0):,} rows, ~{r.get('estimated_tiles', 0)} tiles")
        elif r.get("skipped"):
            log(f"  {region}: SKIPPED")
        else:
            log(f"  {region}: {r.get('rows_written', 0):,} rows, {r.get('tiles_created', 0)} tiles, {r.get('elapsed_seconds', 0):.1f}s")
    
    log("-" * 70)
    log(f"Total: {total_rows:,} rows, {total_tiles} tiles")
    log(f"Processed: {len(results) - len(errors) - len(skipped)} regions")
    log(f"Skipped: {len(skipped)} regions")
    log(f"Errors: {len(errors)} regions")
    log(f"Total time: {total_elapsed:.1f}s")
    log("=" * 70)
    
    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
