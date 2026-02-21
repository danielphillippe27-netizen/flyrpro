#!/usr/bin/env python3
"""
Load municipal data from S3 to Supabase.
Designed to run in GitHub Actions.

Usage:
    python s3_to_supabase_loader.py --source york_buildings
    python s3_to_supabase_loader.py --source all
"""

import os
import sys
import json
import tempfile
import logging
from pathlib import Path
from typing import List, Dict

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')
logger = logging.getLogger(__name__)


def get_s3_files(bucket: str, prefix: str) -> List[Dict]:
    """List all clean data files in S3."""
    import boto3
    
    s3 = boto3.client('s3')
    files = []
    
    paginator = s3.get_paginator('list_objects_v2')
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get('Contents', []):
            if obj['Key'].endswith('_gold.ndjson'):
                files.append({
                    'key': obj['Key'],
                    'size': obj['Size'],
                    'source_id': obj['Key'].split('/')[-2] if '/' in obj['Key'] else 'unknown'
                })
    
    return files


def download_from_s3(bucket: str, key: str, local_path: Path):
    """Download file from S3 to local."""
    import boto3
    
    s3 = boto3.client('s3')
    local_path.parent.mkdir(parents=True, exist_ok=True)
    s3.download_file(bucket, key, str(local_path))
    logger.info(f"Downloaded s3://{bucket}/{key} to {local_path}")
    return local_path


def load_to_supabase(clean_file: Path, table: str):
    """Load clean NDJSON to Supabase."""
    import psycopg2
    
    logger.info(f"Loading {clean_file.name} to {table}...")
    
    conn = psycopg2.connect(
        host=os.environ.get('POSTGRES_HOST'),
        database=os.environ.get('POSTGRES_DB'),
        user=os.environ.get('POSTGRES_USER'),
        password=os.environ.get('POSTGRES_PASSWORD'),
        port=os.environ.get('POSTGRES_PORT')
    )
    
    # Count records
    with open(clean_file, 'r') as f:
        total = sum(1 for _ in f)
    
    logger.info(f"Loading {total} records...")
    
    # Read and insert in batches
    batch_size = 10000
    inserted = 0
    
    with open(clean_file, 'r') as f:
        batch = []
        for line in f:
            batch.append(json.loads(line))
            
            if len(batch) >= batch_size:
                columns = list(batch[0].keys())
                
                with conn.cursor() as cur:
                    cur.executemany(f"""
                        INSERT INTO {table} ({','.join(columns)})
                        VALUES ({','.join(['%s']*len(columns))})
                        ON CONFLICT DO NOTHING
                    """, [tuple(r[c] for c in columns) for r in batch])
                
                conn.commit()
                inserted += len(batch)
                logger.info(f"Inserted {inserted}/{total}")
                batch = []
        
        # Insert remaining
        if batch:
            columns = list(batch[0].keys())
            with conn.cursor() as cur:
                cur.executemany(f"""
                    INSERT INTO {table} ({','.join(columns)})
                    VALUES ({','.join(['%s']*len(columns))})
                    ON CONFLICT DO NOTHING
                """, [tuple(r[c] for c in columns) for r in batch])
            conn.commit()
            inserted += len(batch)
    
    conn.close()
    logger.info(f"✅ Complete! Loaded {inserted} records to {table}")


def main():
    import argparse
    
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, help="Source ID or 'all'")
    args = parser.parse_args()
    
    bucket = os.environ.get('S3_BUCKET_NAME')
    prefix = "municipal_data/clean"
    
    if not bucket:
        logger.error("S3_BUCKET_NAME not set")
        return 1
    
    # Get files from S3
    files = get_s3_files(bucket, prefix)
    logger.info(f"Found {len(files)} files in S3")
    
    # Filter by source if specified
    if args.source != 'all':
        files = [f for f in files if args.source in f['source_id']]
    
    logger.info(f"Processing {len(files)} files")
    
    # Process each file
    for file_info in files:
        source_id = file_info['source_id']
        key = file_info['key']
        
        # Determine table
        if 'building' in source_id.lower():
            table = "ref_buildings_gold"
        elif 'address' in source_id.lower():
            table = "ref_addresses_gold"
        else:
            logger.warning(f"Unknown type for {source_id}, skipping")
            continue
        
        # Download to temp
        with tempfile.TemporaryDirectory() as tmpdir:
            local_file = Path(tmpdir) / f"{source_id}.ndjson"
            download_from_s3(bucket, key, local_file)
            
            # Load to Supabase
            load_to_supabase(local_file, table)
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
