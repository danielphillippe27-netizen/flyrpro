#!/usr/bin/env python3
"""
Upload a gold NDJSON file to the S3 path the Load S3 to Supabase workflow expects.

Usage:
  python 04_upload_gold_to_s3.py <source_id> <path_to_gold.ndjson>
  python 04_upload_gold_to_s3.py york_buildings ./clean/york_buildings/york_buildings_gold.ndjson

Requires: boto3, AWS credentials (env or ~/.aws/credentials).
Bucket from env AWS_BUCKET_NAME or default flyr-pro-addresses-2025.
"""

import argparse
import os
import sys
from datetime import datetime
from pathlib import Path

try:
    import boto3
except ImportError:
    print("pip install boto3", file=sys.stderr)
    sys.exit(1)


def main():
    p = argparse.ArgumentParser(description="Upload gold NDJSON to S3 for Supabase loader")
    p.add_argument("source_id", help="e.g. york_buildings, toronto_addresses")
    p.add_argument("path", type=Path, help="Local path to *_gold.ndjson")
    p.add_argument("--bucket", default=os.environ.get("AWS_BUCKET_NAME", "flyr-pro-addresses-2025"))
    p.add_argument("--date", default=datetime.now().strftime("%Y%m%d"), help="Date folder yyyymmdd (default: today)")
    p.add_argument("--dry-run", action="store_true", help="Print S3 key only, do not upload")
    args = p.parse_args()

    if not args.path.exists():
        print(f"File not found: {args.path}", file=sys.stderr)
        sys.exit(1)

    # gold-standard/canada/ontario/<source_id>/<yyyymmdd>/<source_id>_gold.ndjson
    key = f"gold-standard/canada/ontario/{args.source_id}/{args.date}/{args.source_id}_gold.ndjson"

    if args.dry_run:
        print(f"Would upload {args.path} -> s3://{args.bucket}/{key}")
        return

    s3 = boto3.client("s3")
    s3.upload_file(str(args.path), args.bucket, key)
    print(f"Uploaded s3://{args.bucket}/{key}")


if __name__ == "__main__":
    main()
