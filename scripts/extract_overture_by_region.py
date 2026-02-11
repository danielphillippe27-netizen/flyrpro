#!/usr/bin/env python3
"""
Extract Overture Maps buildings by province/state to S3.

This script queries the global Overture dataset and extracts buildings
for specific regions, saving them as Parquet files to:
s3://flyr-pro-addresses-2025/overture_extracts/buildings/

Usage:
    python extract_overture_by_region.py --region ON --release 2024-11-13.0
    python extract_overture_by_region.py --all-canada --release 2024-11-13.0
    python extract_overture_by_region.py --all-us --release 2024-11-13.0
    python extract_overture_by_region.py --all --release 2024-11-13.0
"""

import argparse
import subprocess
import sys
from typing import Dict, Tuple

# Canadian Provinces
CANADIAN_PROVINCES: Dict[str, Tuple[float, float, float, float]] = {
    # Code: (west, south, east, north)
    "ON": (-95.2, 41.7, -74.3, 56.9),    # Ontario
    "BC": (-139.1, 48.3, -114.0, 60.0),  # British Columbia
    "QC": (-79.8, 45.0, -57.1, 62.6),    # Quebec
    "AB": (-120.0, 49.0, -110.0, 60.0),  # Alberta
    "MB": (-102.0, 49.0, -89.0, 60.0),   # Manitoba
    "SK": (-110.0, 49.0, -101.4, 60.0),  # Saskatchewan
    "NS": (-66.3, 43.4, -59.7, 47.0),    # Nova Scotia
    "NB": (-69.1, 44.6, -63.7, 48.1),    # New Brunswick
    "NL": (-67.8, 46.6, -52.6, 60.4),    # Newfoundland and Labrador
    "PE": (-64.4, 45.9, -62.0, 47.1),    # Prince Edward Island
    "YT": (-141.0, 60.0, -123.8, 69.6),  # Yukon
    "NT": (-136.5, 60.0, -102.0, 78.8),  # Northwest Territories
    "NU": (-120.0, 51.0, -61.0, 83.1),   # Nunavut
}

# US States (simplified - major ones, add more as needed)
US_STATES: Dict[str, Tuple[float, float, float, float]] = {
    # Code: (west, south, east, north)
    "AL": (-88.5, 30.2, -84.9, 35.0),    # Alabama
    "AK": (-179.1, 51.2, -129.9, 71.4),  # Alaska
    "AZ": (-114.8, 31.3, -109.0, 37.0),  # Arizona
    "AR": (-94.6, 33.0, -89.6, 36.5),    # Arkansas
    "CA": (-124.5, 32.5, -114.1, 42.0),  # California
    "CO": (-109.1, 37.0, -102.0, 41.0),  # Colorado
    "CT": (-73.7, 41.0, -71.8, 42.1),    # Connecticut
    "DE": (-75.8, 38.5, -75.0, 39.8),    # Delaware
    "FL": (-87.6, 24.4, -80.0, 31.0),    # Florida
    "GA": (-85.6, 30.4, -80.8, 35.0),    # Georgia
    "HI": (-160.3, 18.9, -154.8, 22.2),  # Hawaii
    "ID": (-117.2, 42.0, -111.0, 49.0),  # Idaho
    "IL": (-91.5, 37.0, -87.5, 42.5),    # Illinois
    "IN": (-88.1, 37.8, -84.8, 41.8),    # Indiana
    "IA": (-96.6, 40.4, -90.1, 43.5),    # Iowa
    "KS": (-102.1, 37.0, -94.6, 40.0),   # Kansas
    "KY": (-89.6, 36.5, -81.9, 39.1),    # Kentucky
    "LA": (-94.0, 28.9, -88.8, 33.0),    # Louisiana
    "ME": (-71.1, 43.1, -66.9, 47.5),    # Maine
    "MD": (-79.5, 37.9, -75.0, 39.7),    # Maryland
    "MA": (-73.5, 41.2, -69.9, 42.9),    # Massachusetts
    "MI": (-90.4, 41.7, -82.4, 48.3),    # Michigan
    "MN": (-97.2, 43.5, -89.5, 49.4),    # Minnesota
    "MS": (-91.7, 30.2, -88.1, 35.0),    # Mississippi
    "MO": (-95.8, 36.0, -89.1, 40.6),    # Missouri
    "MT": (-116.1, 44.4, -104.0, 49.0),  # Montana
    "NE": (-104.1, 40.0, -95.3, 43.0),   # Nebraska
    "NV": (-120.0, 35.0, -114.0, 42.0),  # Nevada
    "NH": (-72.6, 42.7, -70.6, 45.3),    # New Hampshire
    "NJ": (-75.6, 38.9, -73.9, 41.4),    # New Jersey
    "NM": (-109.1, 31.3, -103.0, 37.0),  # New Mexico
    "NY": (-79.8, 40.5, -71.9, 45.0),    # New York
    "NC": (-84.3, 33.8, -75.5, 36.6),    # North Carolina
    "ND": (-104.1, 45.9, -96.6, 49.0),   # North Dakota
    "OH": (-84.8, 38.4, -80.5, 41.9),    # Ohio
    "OK": (-103.0, 33.6, -94.4, 37.0),   # Oklahoma
    "OR": (-124.6, 42.0, -116.5, 46.3),  # Oregon
    "PA": (-80.5, 39.7, -74.7, 42.3),    # Pennsylvania
    "RI": (-71.9, 41.1, -71.1, 42.0),    # Rhode Island
    "SC": (-83.4, 32.0, -78.5, 35.2),    # South Carolina
    "SD": (-104.1, 42.5, -96.4, 45.9),   # South Dakota
    "TN": (-90.3, 35.0, -81.6, 36.7),    # Tennessee
    "TX": (-106.6, 25.8, -93.5, 36.5),   # Texas
    "UT": (-114.1, 37.0, -109.0, 42.0),  # Utah
    "VT": (-73.4, 42.7, -71.5, 45.0),    # Vermont
    "VA": (-83.7, 36.5, -75.2, 39.5),    # Virginia
    "WA": (-124.8, 45.5, -116.9, 49.0),  # Washington
    "WV": (-82.6, 37.2, -77.7, 40.6),    # West Virginia
    "WI": (-92.9, 42.5, -86.8, 47.1),    # Wisconsin
    "WY": (-111.1, 41.0, -104.0, 45.0),  # Wyoming
    "DC": (-77.1, 38.8, -76.9, 39.0),    # District of Columbia
}


def create_duckdb_sql(code: str, bbox: Tuple[float, float, float, float], release: str, local_path: str) -> str:
    """Generate DuckDB SQL for extracting buildings for a region."""
    west, south, east, north = bbox
    
    sql = f"""
INSTALL httpfs;
LOAD httpfs;
INSTALL spatial;
LOAD spatial;

-- Use anonymous credentials for Overture (public bucket)
SET s3_region='us-west-2';
SET s3_access_key_id='';
SET s3_secret_access_key='';

-- Read from Overture and write locally first
COPY (
  SELECT 
    id,
    geometry,
    bbox,
    version,
    sources,
    level,
    subtype,
    class,
    height,
    names,
    has_parts,
    is_underground,
    num_floors,
    num_floors_underground,
    min_height,
    min_floor,
    facade_color,
    facade_material,
    roof_material,
    roof_shape,
    roof_direction,
    roof_orientation,
    roof_color,
    roof_height,
    theme,
    type
  FROM read_parquet('s3://overturemaps-us-west-2/release/{release}/theme=buildings/type=building/*')
  WHERE bbox.xmax >= {west} AND bbox.xmin <= {east}
    AND bbox.ymax >= {south} AND bbox.ymin <= {north}
) TO '{local_path}' (FORMAT PARQUET, COMPRESSION 'ZSTD', ROW_GROUP_SIZE 100000);
"""
    return sql


def extract_region(code: str, bbox: Tuple[float, float, float, float], release: str, dry_run: bool = False):
    """Extract buildings for a single region."""
    print(f"\n{'='*60}")
    print(f"Extracting {code}: bbox {bbox}")
    print(f"{'='*60}")
    
    import tempfile
    import os
    
    with tempfile.TemporaryDirectory() as tmpdir:
        local_path = os.path.join(tmpdir, f"{code}.parquet")
        sql = create_duckdb_sql(code, bbox, release, local_path)
        
        if dry_run:
            print("SQL Preview:")
            print(sql[:500] + "...")
            return True
        
        # Step 1: Extract from Overture to local file
        print(f"Step 1: Querying Overture (this may take 5-10 minutes)...")
        try:
            result = subprocess.run(
                ["duckdb", "-c", sql],
                capture_output=True,
                text=True,
                timeout=600  # 10 minutes timeout per region
            )
            
            if result.returncode != 0:
                print(f"ERROR querying Overture for {code}:")
                print(result.stderr)
                return False
            
            # Check file size
            file_size = os.path.getsize(local_path)
            print(f"✅ Extracted {code}: {file_size:,} bytes ({file_size/1024/1024:.1f} MB)")
            
        except subprocess.TimeoutExpired:
            print(f"⏱️ Timeout extracting {code} (took >10 minutes)")
            return False
        except Exception as e:
            print(f"❌ Error extracting {code}: {e}")
            return False
        
        # Step 2: Upload to S3
        print(f"Step 2: Uploading to S3...")
        s3_key = f"overture_extracts/buildings/release={release}/region={code}/data.parquet"
        s3_uri = f"s3://flyr-pro-addresses-2025/{s3_key}"
        
        try:
            result = subprocess.run(
                ["aws", "s3", "cp", local_path, s3_uri, "--region", "us-east-2"],
                capture_output=True,
                text=True,
                timeout=60
            )
            
            if result.returncode != 0:
                print(f"ERROR uploading to S3:")
                print(result.stderr)
                return False
            
            print(f"✅ Uploaded to {s3_uri}")
            return True
            
        except Exception as e:
            print(f"❌ Error uploading to S3: {e}")
            return False


def main():
    parser = argparse.ArgumentParser(description="Extract Overture buildings by region")
    parser.add_argument("--region", help="Single region code (e.g., ON, CA, TX)")
    parser.add_argument("--all-canada", action="store_true", help="Extract all Canadian provinces")
    parser.add_argument("--all-us", action="store_true", help="Extract all US states")
    parser.add_argument("--all", action="store_true", help="Extract all regions")
    parser.add_argument("--release", default="2024-11-13.0", help="Overture release version")
    parser.add_argument("--dry-run", action="store_true", help="Show SQL without executing")
    
    args = parser.parse_args()
    
    # Build list of regions to extract
    regions = []
    
    if args.region:
        code = args.region.upper()
        if code in CANADIAN_PROVINCES:
            regions.append((code, CANADIAN_PROVINCES[code]))
        elif code in US_STATES:
            regions.append((code, US_STATES[code]))
        else:
            print(f"Unknown region: {code}")
            sys.exit(1)
    
    if args.all_canada or args.all:
        for code, bbox in CANADIAN_PROVINCES.items():
            regions.append((code, bbox))
    
    if args.all_us or args.all:
        for code, bbox in US_STATES.items():
            regions.append((code, bbox))
    
    if not regions:
        print("No regions specified. Use --region, --all-canada, --all-us, or --all")
        sys.exit(1)
    
    print(f"Extracting {len(regions)} regions from Overture {args.release}")
    print(f"Output: s3://flyr-pro-addresses-2025/overture_extracts/buildings/")
    
    if args.dry_run:
        print("\n⚠️ DRY RUN - No actual extraction")
    
    # Extract each region
    success_count = 0
    fail_count = 0
    
    for i, (code, bbox) in enumerate(regions, 1):
        print(f"\n[{i}/{len(regions)}]", end="")
        if extract_region(code, bbox, args.release, args.dry_run):
            success_count += 1
        else:
            fail_count += 1
    
    print(f"\n\n{'='*60}")
    print(f"Complete: {success_count} succeeded, {fail_count} failed")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
