#!/usr/bin/env python3
"""
Extract remaining Canadian regions for FLYR PRO
Supports parallel processing for faster extraction
"""

import argparse
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime

# Canadian regions still missing from S3 (11 regions)
CANADA_REGIONS = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "QC", "SK", "YT"]

def extract_region_theme(args):
    """Extract a single region/theme combination"""
    region, theme, ssd_path = args
    
    print(f"📍 [{datetime.now().strftime('%H:%M:%S')}] Starting {region} - {theme}")
    
    cmd = [
        "python3", "extract_overture_na.py",
        "--themes", theme,
        "--regions", region,
        "--ssd-path", ssd_path
    ]
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=3600,  # 1 hour timeout per region
            env={**dict(subprocess.os.environ), "AWS_PROFILE": "deploy"}
        )
        
        if result.returncode == 0:
            print(f"✅ [{datetime.now().strftime('%H:%M:%S')}] Complete {region} - {theme}")
            return (region, theme, "success", None)
        else:
            print(f"❌ [{datetime.now().strftime('%H:%M:%S')}] Failed {region} - {theme}")
            return (region, theme, "failed", result.stderr)
    except subprocess.TimeoutExpired:
        print(f"⏰ [{datetime.now().strftime('%H:%M:%S')}] Timeout {region} - {theme}")
        return (region, theme, "timeout", None)
    except Exception as e:
        print(f"💥 [{datetime.now().strftime('%H:%M:%S')}] Error {region} - {theme}: {e}")
        return (region, theme, "error", str(e))

def main():
    parser = argparse.ArgumentParser(description="Extract remaining Canadian regions")
    parser.add_argument("--theme", choices=["buildings", "roads", "divisions", "all"], 
                        default="all", help="Which theme to extract")
    parser.add_argument("--ssd-path", default="/Volumes/Untitled 2/na_extract.db",
                        help="Path to DuckDB database")
    parser.add_argument("--workers", "-j", type=int, default=2,
                        help="Number of parallel workers (default: 2)")
    parser.add_argument("--region", help="Extract specific region only (e.g., BC)")
    
    args = parser.parse_args()
    
    # Determine themes to extract
    if args.theme == "all":
        themes = ["buildings", "roads", "divisions"]
    else:
        themes = [args.theme]
    
    # Determine regions to extract
    if args.region:
        if args.region not in CANADA_REGIONS:
            print(f"❌ Region {args.region} not in missing list: {CANADA_REGIONS}")
            sys.exit(1)
        regions = [args.region]
    else:
        regions = CANADA_REGIONS
    
    # Build task list
    tasks = [(r, t, args.ssd_path) for r in regions for t in themes]
    
    print("=" * 60)
    print("FLYR PRO - Canada Extraction")
    print("=" * 60)
    print(f"Themes: {themes}")
    print(f"Regions ({len(regions)}): {regions}")
    print(f"SSD Path: {args.ssd_path}")
    print(f"Workers: {args.workers}")
    print(f"Total tasks: {len(tasks)}")
    print("=" * 60)
    print()
    
    start_time = datetime.now()
    
    # Run extractions in parallel
    results = []
    with ProcessPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(extract_region_theme, task): task for task in tasks}
        
        for future in as_completed(futures):
            result = future.result()
            results.append(result)
    
    # Summary
    elapsed = datetime.now() - start_time
    success = sum(1 for r in results if r[2] == "success")
    failed = sum(1 for r in results if r[2] != "success")
    
    print()
    print("=" * 60)
    print("EXTRACTION COMPLETE")
    print("=" * 60)
    print(f"Elapsed time: {elapsed}")
    print(f"Success: {success}/{len(tasks)}")
    print(f"Failed: {failed}/{len(tasks)}")
    
    if failed > 0:
        print("\nFailed tasks:")
        for region, theme, status, error in results:
            if status != "success":
                print(f"  - {region}/{theme}: {status}")
                if error:
                    print(f"    Error: {error[:200]}")
    
    return 0 if failed == 0 else 1

if __name__ == "__main__":
    sys.exit(main())
