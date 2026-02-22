#!/usr/bin/env python3
"""
02_unzip_to_raw.py
Unzip municipal data zips from SSD into raw/ layout for 03_process_*.

Usage:
  python 02_unzip_to_raw.py /path/on/ssd/York_buildings.zip [/path/on/ssd/York_addresses.zip ...]
  python 02_unzip_to_raw.py --storage /Volumes/SSD/municipal_data *.zip

Extracts each zip to <STORAGE_PATH>/raw/<zip_stem>/ so that 03_process_york.py
(or another processor) can find the .shp files. Zip stem = filename without .zip
(e.g. York_buildings.zip -> raw/York_buildings/).

Requires: Python 3 (zipfile is stdlib).
"""

import argparse
import zipfile
from pathlib import Path


def main():
    p = argparse.ArgumentParser(description="Unzip municipal zips to raw/ for gold pipeline")
    p.add_argument(
        "zips",
        nargs="+",
        type=Path,
        help="Paths to .zip files (e.g. on SSD)",
    )
    p.add_argument(
        "--storage",
        type=Path,
        default=Path("/Volumes/Untitled 2/municipal_data"),
        help="Base storage path (default: same as 03_process_york STORAGE_PATH)",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Print extract paths only, do not unzip",
    )
    args = p.parse_args()

    raw_dir = args.storage / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    for zip_path in args.zips:
        if not zip_path.suffix.lower() == ".zip":
            print(f"Skip (not .zip): {zip_path}")
            continue
        if not zip_path.exists():
            print(f"Skip (missing): {zip_path}")
            continue

        # e.g. York_buildings.zip -> York_buildings
        stem = zip_path.stem
        out_dir = raw_dir / stem

        if args.dry_run:
            print(f"Would extract {zip_path} -> {out_dir}")
            continue

        out_dir.mkdir(parents=True, exist_ok=True)
        print(f"Extracting {zip_path} -> {out_dir}")
        with zipfile.ZipFile(zip_path, "r") as z:
            z.extractall(out_dir)

        # List .shp so user can point 03 at them
        shps = list(out_dir.rglob("*.shp"))
        if shps:
            print(f"  Found {len(shps)} .shp: {[str(s.relative_to(out_dir)) for s in shps]}")

    if not args.dry_run:
        print("Done. Run 03_process_york.py (or processor with --buildings-shp / --addresses-shp).")


if __name__ == "__main__":
    main()
