# Overture Buildings Extraction Guide

This document describes how to run the batch extraction job that pre-processes global Overture buildings into region/tile-partitioned Parquet files for efficient Lambda querying.

## Overview

The extraction script reads from:
```
s3://overturemaps-us-west-2/release/${OVERTURE_RELEASE}/theme=buildings/type=building/*
```

And writes to:
```
s3://flyr-pro-addresses-2025/overture_extracts/buildings/release=${RELEASE}/region=${CODE}/tile_y=${Y}/tile_x=${X}/part-*.parquet
```

## Prerequisites

### Python Dependencies

```bash
pip install duckdb>=0.10.0
```

### AWS Credentials

The script uses the AWS credential chain (via DuckDB's `CREDENTIAL_CHAIN` provider). Ensure one of:

1. **Local development**: `AWS_PROFILE` environment variable or default credentials
2. **EC2/ECS**: Instance/execution role with S3 access
3. **Lambda**: Execution role (not used for batch extraction)

Required IAM permissions:
- `s3:GetObject` on `arn:aws:s3:::overturemaps-us-west-2/*`
- `s3:ListBucket` on `arn:aws:s3:::overturemaps-us-west-2`
- `s3:PutObject` on `arn:aws:s3:::flyr-pro-addresses-2025/overture_extracts/*`
- `s3:ListBucket` on `arn:aws:s3:::flyr-pro-addresses-2025`

## Local Run (Mac/Linux)

### Basic Usage

```bash
# Extract Ontario only (dry run first to estimate)
AWS_PROFILE=deploy python3 scripts/extract_overture_buildings_by_region.py \
  --region ON \
  --release 2026-01-21.0 \
  --tile-deg 0.25 \
  --dry-run

# Actually extract Ontario
AWS_PROFILE=deploy python3 scripts/extract_overture_buildings_by_region.py \
  --region ON \
  --release 2026-01-21.0 \
  --tile-deg 0.25
```

### Extract All Regions

```bash
# Extract all regions defined in regions.json
AWS_PROFILE=deploy python3 scripts/extract_overture_buildings_by_region.py \
  --release 2026-01-21.0 \
  --tile-deg 0.25
```

### Skip Existing Extracts

```bash
# Skip regions that already have extracts in S3
AWS_PROFILE=deploy python3 scripts/extract_overture_buildings_by_region.py \
  --release 2026-01-21.0 \
  --tile-deg 0.25 \
  --skip-existing
```

### Environment Variables

Instead of command-line args, you can use env vars:

```bash
export OVERTURE_RELEASE=2025-01-22.0
export TILE_DEG=0.25
export OUT_BUCKET=flyr-pro-addresses-2025
export OUT_PREFIX=overture_extracts/buildings

AWS_PROFILE=deploy python3 scripts/extract_overture_buildings_by_region.py --region ON
```

## EC2 Run

### 1. Launch EC2 Instance

Recommended specs for full North America extraction:
- **Instance type**: `m6i.2xlarge` or larger
- **Storage**: 50GB+ root volume (temporary space for DuckDB)
- **AMI**: Amazon Linux 2023 or Ubuntu 22.04

### 2. Install Dependencies

```bash
# Update system
sudo yum update -y  # Amazon Linux
# OR
sudo apt-get update  # Ubuntu

# Install Python and pip
sudo yum install -y python3 python3-pip  # Amazon Linux
# OR
sudo apt-get install -y python3 python3-pip  # Ubuntu

# Install DuckDB Python
pip3 install duckdb>=0.10.0
```

### 3. Configure IAM Role

Attach an IAM role to the EC2 instance with the required S3 permissions (see Prerequisites).

### 4. Copy Scripts

```bash
# From your local machine
scp -i ~/.ssh/your-key.pem scripts/extract_overture_buildings_by_region.py scripts/regions.json ec2-user@<instance-ip>:~/

# SSH to instance
ssh -i ~/.ssh/your-key.pem ec2-user@<instance-ip>
```

### 5. Run Extraction

```bash
# Dry run Ontario first
cd ~
python3 extract_overture_buildings_by_region.py \
  --region ON \
  --release 2026-01-21.0 \
  --tile-deg 0.25 \
  --dry-run

# Extract Ontario
python3 extract_overture_buildings_by_region.py \
  --region ON \
  --release 2026-01-21.0 \
  --tile-deg 0.25

# Extract all regions (will take hours)
python3 extract_overture_buildings_by_region.py \
  --release 2026-01-21.0 \
  --tile-deg 0.25
```

### 6. Monitor Progress

The script outputs progress logs to stdout. For long-running extractions:

```bash
# Run in screen/tmux
tmux new -s extraction
python3 extract_overture_buildings_by_region.py --release 2026-01-21.0

# Detach: Ctrl+B, then D
# Reattach: tmux attach -t extraction
```

## Verification

### List Extracted Files

```bash
# List Ontario extracts
aws s3 ls s3://flyr-pro-addresses-2025/overture_extracts/buildings/release=2025-01-22.0/region=ON/ --recursive | head -20

# Count total files
aws s3 ls s3://flyr-pro-addresses-2025/overture_extracts/buildings/release=2025-01-22.0/ --recursive | wc -l
```

### DuckDB Sanity Query

```bash
# Local verification with DuckDB CLI
duckdb -c "
  SELECT 
    region, 
    tile_y, 
    tile_x, 
    COUNT(*) as building_count
  FROM read_parquet(
    's3://flyr-pro-addresses-2025/overture_extracts/buildings/release=2025-01-22.0/region=ON/*/*/*.parquet',
    hive_partitioning=1
  )
  GROUP BY region, tile_y, tile_x
  ORDER BY building_count DESC
  LIMIT 10;
"
```

### Count Total Buildings

```bash
duckdb -c "
  SELECT COUNT(*) as total_buildings
  FROM read_parquet(
    's3://flyr-pro-addresses-2025/overture_extracts/buildings/release=2025-01-22.0/region=ON/*/*/*.parquet',
    hive_partitioning=1
  );
"
```

## Adding New Regions

To add a new region, edit `scripts/regions.json`:

```json
{
  "code": "AB",
  "name": "Alberta",
  "country": "CA",
  "bbox": [-120.0, 48.99, -110.0, 60.0]
}
```

Then run extraction:

```bash
AWS_PROFILE=deploy python3 scripts/extract_overture_buildings_by_region.py --region AB
```

## Troubleshooting

### "Failed to load AWS credentials"

- Verify `AWS_PROFILE` is set or default credentials exist
- Check `~/.aws/credentials` and `~/.aws/config`
- For EC2: verify IAM role is attached to instance

### "No buildings found for X"

- Verify bbox coordinates in `regions.json`
- Check Overture release exists: `aws s3 ls s3://overturemaps-us-west-2/release/`

### Slow extraction

- Use larger EC2 instance (more RAM for DuckDB)
- Extract regions individually rather than all at once
- Consider reducing `TILE_DEG` to 0.5 for fewer/smaller partitions

### Out of memory

- DuckDB is memory-intensive; use at least 8GB RAM
- Process regions one at a time with `--region`

## Tile Partitioning Strategy

The default tile size is **0.25 degrees**, which provides:
- ~200-500KB Parquet files per tile in urban areas
- ~10-50KB Parquet files per tile in rural areas
- Reasonable Lambda scan performance (<10s for small polygons)

For dense urban regions (Toronto, NYC), consider **0.125 degrees**.
For sparse rural regions, **0.5 degrees** may be sufficient.

## Lambda Configuration

After extraction, configure the Lambda with these environment variables:

```bash
EXTRACT_BUCKET=flyr-pro-addresses-2025
EXTRACT_PREFIX=overture_extracts/buildings
OVERTURE_RELEASE=2025-01-22.0
TILE_DEG=0.25
MAX_TILES_PER_REQUEST=400
```

The Lambda will automatically query only the relevant tiles for each request polygon.
