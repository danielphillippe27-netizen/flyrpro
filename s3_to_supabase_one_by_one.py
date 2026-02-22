#!/usr/bin/env python3
"""
Run S3 -> Supabase loader one source at a time.

Behavior:
- If --source is provided (and not "auto"), run that source directly.
- If --source=auto (default), pick the next source whose latest S3 key
  is not marked completed in public.loader_loaded_files.
"""

import argparse
import os
import subprocess
import sys
from typing import Dict, List, Set

import s3_to_supabase_loader as loader


def completed_keys() -> Set[str]:
    conn = loader.pg_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s3_key
                FROM public.loader_loaded_files
                WHERE status = 'completed'
                """
            )
            return {row[0] for row in cur.fetchall()}
    finally:
        conn.close()


def next_pending_source(files: List[Dict], done: Set[str]) -> str | None:
    pending = [f for f in files if f.get("key") not in done]
    # Prefer addresses first, then buildings, then lexicographic fallback.
    pending.sort(
        key=lambda f: (
            0 if "address" in f.get("source_id", "").lower() else 1,
            f.get("source_id", ""),
        )
    )
    if not pending:
        return None
    return pending[0].get("source_id")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source",
        default="auto",
        help="Specific source_id to run, or 'auto' to pick next pending source",
    )
    parser.add_argument("--dry-run", action="store_true", help="Count only, no inserts")
    parser.add_argument("--vacuum", action="store_true", help="Run vacuum after load")
    args = parser.parse_args()

    bucket = os.environ.get("S3_BUCKET_NAME") or os.environ.get("AWS_BUCKET_NAME")
    if not bucket:
        print("S3_BUCKET_NAME or AWS_BUCKET_NAME not set", file=sys.stderr)
        return 1

    source = args.source.strip()
    if source.lower() == "all":
        # Explicit all still means all; use core loader directly.
        cmd = [sys.executable, "s3_to_supabase_loader.py", "--source", "all"]
        if args.dry_run:
            cmd.append("--dry-run")
        if args.vacuum:
            cmd.append("--vacuum")
        subprocess.run(cmd, check=True)
        return 0

    if source.lower() == "auto":
        loader.maybe_force_ipv4_for_non_pooler_host()
        if not args.dry_run:
            loader.ensure_loaded_files_table()
        files = loader.pick_latest_per_source(
            loader.get_s3_files(bucket, "gold-standard/canada/ontario")
        )
        print(f"Found {len(files)} latest source file(s)")

        if args.dry_run:
            # In dry-run mode, just pick first by priority.
            selected = next_pending_source(files, set())
        else:
            selected = next_pending_source(files, completed_keys())

        if not selected:
            print("No pending sources. Backfill is complete.")
            return 0
        source = selected
        print(f"Selected next source: {source}")

    cmd = [sys.executable, "s3_to_supabase_loader.py", "--source", source]
    if args.dry_run:
        cmd.append("--dry-run")
    if args.vacuum:
        cmd.append("--vacuum")

    subprocess.run(cmd, check=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
