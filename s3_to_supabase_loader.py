#!/usr/bin/env python3
"""
Load municipal data from S3 to Supabase.
Designed to run in GitHub Actions.

Usage:
    python s3_to_supabase_loader.py --source york_buildings
    python s3_to_supabase_loader.py --source all
"""

import argparse
import json
import logging
import os
import re
import socket
import sys
import tempfile
import time
from pathlib import Path
from typing import Dict, List, Tuple

import boto3
import psycopg2
from psycopg2.extras import execute_values

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(message)s")
logger = logging.getLogger(__name__)

CHUNK_SIZE = int(os.environ.get("CHUNK_SIZE", "10000"))
MAX_RETRIES = int(os.environ.get("MAX_RETRIES", "3"))
RETRY_BASE_SECONDS = int(os.environ.get("RETRY_BASE_SECONDS", "2"))
DB_STATEMENT_TIMEOUT_MS = int(os.environ.get("DB_STATEMENT_TIMEOUT_MS", "0"))
DB_CONNECT_RETRIES = int(os.environ.get("DB_CONNECT_RETRIES", "12"))
DB_CONNECT_RETRY_SECONDS = int(os.environ.get("DB_CONNECT_RETRY_SECONDS", "5"))
POSTGRES_SSLMODE = os.environ.get("POSTGRES_SSLMODE", "require")
IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def env_flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "y", "on"}


def maybe_force_ipv4_for_non_pooler_host() -> None:
    host = (os.environ.get("POSTGRES_HOST") or "").strip()
    if not host:
        return
    if host.endswith("pooler.supabase.com"):
        logger.info("Using pooler hostname without IPv4 rewrite: %s", host)
        return
    try:
        infos = socket.getaddrinfo(host, None, socket.AF_INET)
        if infos:
            ipv4 = infos[0][4][0]
            os.environ["POSTGRES_HOST"] = ipv4
            logger.info("Resolved POSTGRES_HOST to IPv4: %s", ipv4)
    except Exception as e:
        logger.warning("Could not resolve POSTGRES_HOST to IPv4: %s", e)


def validate_db_env() -> None:
    host = (os.environ.get("POSTGRES_HOST") or "").strip()
    port = (os.environ.get("POSTGRES_PORT") or "").strip()
    user = (os.environ.get("POSTGRES_USER") or "").strip()
    db = (os.environ.get("POSTGRES_DB") or "").strip()

    if not host or not port or not user or not db:
        raise RuntimeError("Missing one or more DB env vars: POSTGRES_HOST/POSTGRES_PORT/POSTGRES_USER/POSTGRES_DB")

    if host.endswith("pooler.supabase.com") and port not in {"5432", "6543"}:
        raise RuntimeError(
            f"Pooler host detected ({host}) but POSTGRES_PORT={port}. "
            "Use 5432 (session pooler) or 6543 (transaction pooler)."
        )


def quote_ident(ident: str) -> str:
    if not IDENT_RE.match(ident):
        raise ValueError(f"Invalid SQL identifier: {ident!r}")
    return f'"{ident}"'


def pg_conn():
    host = (os.environ.get("POSTGRES_HOST") or "").strip()
    db = (os.environ.get("POSTGRES_DB") or "").strip()
    user = (os.environ.get("POSTGRES_USER") or "").strip()
    password = (os.environ.get("POSTGRES_PASSWORD") or "").strip()
    port = (os.environ.get("POSTGRES_PORT") or "").strip()

    last_error = None
    for attempt in range(1, DB_CONNECT_RETRIES + 1):
        try:
            conn = psycopg2.connect(
                host=host,
                database=db,
                user=user,
                password=password,
                port=port,
                sslmode=POSTGRES_SSLMODE,
                connect_timeout=30,
                keepalives=1,
                keepalives_idle=30,
                keepalives_interval=10,
                keepalives_count=5,
            )
            with conn.cursor() as cur:
                cur.execute("SET statement_timeout = %s", (DB_STATEMENT_TIMEOUT_MS,))
            return conn
        except psycopg2.OperationalError as e:
            last_error = e
            msg = str(e).lower()
            retryable = any(
                token in msg
                for token in [
                    "maxclientsinsessionmode",
                    "max clients",
                    "too many connections",
                    "timeout",
                    "timed out",
                    "connection",
                ]
            )
            if not retryable or attempt >= DB_CONNECT_RETRIES:
                raise
            sleep_s = DB_CONNECT_RETRY_SECONDS * attempt
            logger.warning(
                "DB connect attempt %s/%s failed (%s). Retrying in %ss...",
                attempt,
                DB_CONNECT_RETRIES,
                str(e),
                sleep_s,
            )
            time.sleep(sleep_s)
    if last_error:
        raise last_error
    raise psycopg2.OperationalError("Failed to establish DB connection")


def is_retryable_error(err: Exception) -> bool:
    msg = str(err).lower()
    if isinstance(err, (psycopg2.OperationalError, psycopg2.InterfaceError)):
        return True
    retry_tokens = [
        "timeout",
        "timed out",
        "connection",
        "server closed",
        "connection reset",
        "broken pipe",
        "could not connect",
        "ssl",
    ]
    return any(token in msg for token in retry_tokens)


def ensure_loaded_files_table():
    conn = pg_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS public.loader_loaded_files (
                  s3_key text PRIMARY KEY,
                  source_id text NOT NULL,
                  status text NOT NULL DEFAULT 'in_progress',
                  rows_loaded bigint NOT NULL DEFAULT 0,
                  attempts integer NOT NULL DEFAULT 0,
                  last_error text,
                  updated_at timestamptz NOT NULL DEFAULT now(),
                  loaded_at timestamptz
                );
                """
            )
        conn.commit()
    finally:
        conn.close()


def is_file_completed(s3_key: str) -> bool:
    conn = pg_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM public.loader_loaded_files WHERE s3_key = %s AND status = 'completed'",
                (s3_key,),
            )
            return cur.fetchone() is not None
    finally:
        conn.close()


def mark_file_status(
    s3_key: str,
    source_id: str,
    status: str,
    rows_loaded: int = 0,
    last_error: str = None,
):
    conn = pg_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.loader_loaded_files (
                  s3_key, source_id, status, rows_loaded, attempts, last_error, updated_at, loaded_at
                ) VALUES (
                  %s,
                  %s,
                  %s,
                  %s,
                  CASE WHEN %s = 'in_progress' THEN 1 ELSE 0 END,
                  %s,
                  now(),
                  CASE WHEN %s = 'completed' THEN now() ELSE NULL END
                )
                ON CONFLICT (s3_key) DO UPDATE SET
                  source_id = EXCLUDED.source_id,
                  status = EXCLUDED.status,
                  rows_loaded = EXCLUDED.rows_loaded,
                  attempts = CASE
                    WHEN EXCLUDED.status = 'in_progress' THEN public.loader_loaded_files.attempts + 1
                    ELSE public.loader_loaded_files.attempts
                  END,
                  last_error = EXCLUDED.last_error,
                  updated_at = now(),
                  loaded_at = CASE WHEN EXCLUDED.status = 'completed' THEN now() ELSE public.loader_loaded_files.loaded_at END;
                """,
                (s3_key, source_id, status, rows_loaded, status, last_error, status),
            )
        conn.commit()
    finally:
        conn.close()


def get_s3_files(bucket: str, prefix: str) -> List[Dict]:
    """List all clean data files in S3."""
    s3 = boto3.client("s3")
    files: List[Dict] = []

    def source_id_from_key(key: str) -> str:
        # Expected shape:
        # gold-standard/canada/ontario/<source_id>/<yyyymmdd>/<source_id>_gold.ndjson
        parts = key.split("/")
        filename = parts[-1] if parts else ""

        # Prefer filename-derived source ID if present.
        if filename.endswith("_gold.ndjson"):
            return filename[: -len("_gold.ndjson")]

        # Fallback for legacy/path-only structures.
        if len(parts) >= 3:
            return parts[-3]
        if len(parts) >= 2:
            return parts[-2]
        return "unknown"

    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.endswith("_gold.ndjson"):
                files.append(
                    {
                        "key": key,
                        "size": obj["Size"],
                        "source_id": source_id_from_key(key),
                    }
                )

    files.sort(key=lambda f: f["key"])
    return files


def pick_latest_per_source(files: List[Dict]) -> List[Dict]:
    """Keep only the latest dated key per source_id."""
    latest: Dict[str, Dict] = {}
    for f in files:
        key = f.get("key", "")
        source_id = f.get("source_id", "")
        parts = key.split("/")
        # Expected .../<source_id>/<yyyymmdd>/<filename>
        date_folder = parts[-2] if len(parts) >= 2 else ""
        prev = latest.get(source_id)
        if prev is None or date_folder > prev.get("_date_folder", ""):
            item = dict(f)
            item["_date_folder"] = date_folder
            latest[source_id] = item

    result = []
    for item in latest.values():
        item.pop("_date_folder", None)
        result.append(item)
    result.sort(key=lambda x: x.get("source_id", ""))
    return result


def download_from_s3(bucket: str, key: str, local_path: Path):
    """Download file from S3 to local."""
    s3 = boto3.client("s3")
    local_path.parent.mkdir(parents=True, exist_ok=True)
    s3.download_file(bucket, key, str(local_path))
    logger.info("Downloaded s3://%s/%s to %s", bucket, key, local_path)
    return local_path


def execute_batch_with_retry(
    conn,
    table: str,
    columns: List[str],
    batch: List[Dict],
) -> Tuple[object, int]:
    table_ident = quote_ident(table)
    col_idents = ",".join(quote_ident(c) for c in columns)
    sql = (
        f"INSERT INTO {table_ident} ({col_idents}) VALUES %s "
        "ON CONFLICT DO NOTHING"
    )
    values = [tuple(r.get(c) for c in columns) for r in batch]

    attempts = 0
    while True:
        attempts += 1
        try:
            with conn.cursor() as cur:
                execute_values(cur, sql, values, page_size=min(CHUNK_SIZE, 1000))
            conn.commit()
            return conn, len(batch)
        except Exception as e:
            try:
                conn.rollback()
            except Exception:
                pass
            retryable = is_retryable_error(e)
            if not retryable or attempts >= MAX_RETRIES:
                raise
            sleep_s = RETRY_BASE_SECONDS * (2 ** (attempts - 1))
            logger.warning(
                "Batch insert failed (attempt %s/%s): %s; retrying in %ss",
                attempts,
                MAX_RETRIES,
                str(e),
                sleep_s,
            )
            try:
                conn.close()
            except Exception:
                pass
            time.sleep(sleep_s)
            conn = pg_conn()


def load_to_supabase(clean_file: Path, table: str, s3_key: str, source_id: str) -> int:
    """Load clean NDJSON to Supabase with retries and file-level resume."""
    logger.info("Loading %s to %s...", clean_file.name, table)

    if is_file_completed(s3_key):
        logger.info("Skipping already completed file: %s", s3_key)
        return 0

    mark_file_status(s3_key, source_id, "in_progress")

    with open(clean_file, "r") as f:
        total = sum(1 for _ in f)
    logger.info("Loading %s records (chunk size: %s)...", f"{total:,}", CHUNK_SIZE)

    conn = pg_conn()
    inserted = 0
    batch: List[Dict] = []
    columns: List[str] = []

    try:
        with open(clean_file, "r") as f:
            for line in f:
                record = json.loads(line)
                if not columns:
                    columns = list(record.keys())
                batch.append(record)

                if len(batch) >= CHUNK_SIZE:
                    conn, added = execute_batch_with_retry(conn, table, columns, batch)
                    inserted += added
                    logger.info("Inserted %s/%s", f"{inserted:,}", f"{total:,}")
                    batch = []

            if batch:
                conn, added = execute_batch_with_retry(conn, table, columns, batch)
                inserted += added

        mark_file_status(s3_key, source_id, "completed", rows_loaded=inserted)
        logger.info("Complete! Loaded %s records to %s", f"{inserted:,}", table)
        return inserted
    except Exception as e:
        mark_file_status(s3_key, source_id, "failed", last_error=str(e)[:2000])
        raise
    finally:
        try:
            conn.close()
        except Exception:
            pass


def run_with_retries(clean_file: Path, table: str, s3_key: str, source_id: str) -> int:
    attempts = 0
    while attempts < MAX_RETRIES:
        attempts += 1
        try:
            return load_to_supabase(clean_file, table, s3_key, source_id)
        except Exception as e:
            retryable = is_retryable_error(e)
            if not retryable or attempts >= MAX_RETRIES:
                raise
            sleep_s = RETRY_BASE_SECONDS * (2 ** (attempts - 1))
            logger.warning(
                "Retrying file %s (%s/%s) after error: %s (sleep %ss)",
                s3_key,
                attempts,
                MAX_RETRIES,
                str(e),
                sleep_s,
            )
            time.sleep(sleep_s)
    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, help="Source ID or 'all'")
    parser.add_argument("--dry-run", action="store_true", help="Count/validate only, no inserts")
    parser.add_argument("--vacuum", action="store_true", help="Run VACUUM ANALYZE after load")
    args = parser.parse_args()

    bucket = os.environ.get("S3_BUCKET_NAME") or os.environ.get("AWS_BUCKET_NAME")
    prefix = "gold-standard/canada/ontario"
    dry_run = args.dry_run or env_flag("DRY_RUN", False)
    do_vacuum = args.vacuum or env_flag("DO_VACUUM", False)

    if not bucket:
        logger.error("S3_BUCKET_NAME or AWS_BUCKET_NAME not set")
        return 1

    maybe_force_ipv4_for_non_pooler_host()
    validate_db_env()

    if not dry_run:
        ensure_loaded_files_table()

    files = get_s3_files(bucket, prefix)
    files = pick_latest_per_source(files)
    logger.info("Found %s latest file(s) in S3", len(files))

    if args.source != "all":
        requested = args.source.strip()
        exact = [f for f in files if f["source_id"] == requested]
        if exact:
            files = exact
        else:
            files = [f for f in files if requested in f["source_id"] or requested in f["key"]]

    logger.info("Processing %s files", len(files))

    for file_info in files:
        source_id = file_info["source_id"]
        key = file_info["key"]

        if "building" in source_id.lower():
            table = "ref_buildings_gold"
        elif "address" in source_id.lower():
            table = "ref_addresses_gold"
        else:
            logger.warning("Unknown type for %s, skipping", source_id)
            continue

        with tempfile.TemporaryDirectory() as tmpdir:
            local_file = Path(tmpdir) / f"{source_id}.ndjson"
            download_from_s3(bucket, key, local_file)
            if dry_run:
                count = 0
                with open(local_file, "r") as f:
                    for line in f:
                        if line.strip():
                            count += 1
                logger.info("[DRY RUN] %s -> %s: %s rows", source_id, table, f"{count:,}")
            else:
                run_with_retries(local_file, table, key, source_id)

    if do_vacuum and not dry_run:
        logger.info("Running VACUUM ANALYZE on gold tables...")
        conn = pg_conn()
        try:
            conn.autocommit = True
            with conn.cursor() as cur:
                cur.execute("VACUUM ANALYZE public.ref_buildings_gold")
                cur.execute("VACUUM ANALYZE public.ref_addresses_gold")
        finally:
            conn.close()
        logger.info("VACUUM ANALYZE complete")

    return 0


if __name__ == "__main__":
    sys.exit(main())
