# EC2 Deployment Guide - North American Overture Extraction

This guide walks through deploying the "Big Play" extraction on an EC2 instance for processing all 64 North American regions (50 US states + DC + 13 Canadian provinces/territories).

## Expected Metrics

| Metric | Value |
|--------|-------|
| **Total Buildings** | ~250-300 million |
| **Total Roads** | ~50-100 million segments |
| **Total Divisions** | ~10-50 thousand boundaries |
| **S3 Storage** | ~150-200 GB |
| **Monthly S3 Cost** | ~$4.60/month |
| **Extraction Time** | 4-8 hours |
| **Lambda Query Time** | <5 seconds |

## Step 1: Launch EC2 Instance

### Recommended Instance Specs

```
Instance Type: m6i.2xlarge (8 vCPU, 32 GB RAM)
Storage: 100 GB gp3 EBS (for temp database)
OS: Ubuntu 22.04 LTS
Region: us-east-2 (same as your output bucket)
```

### IAM Role

Attach an IAM role with these permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::overturemaps-us-west-2",
        "arn:aws:s3:::overturemaps-us-west-2/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:ListBucket",
        "s3:GetBucketLocation"
      ],
      "Resource": [
        "arn:aws:s3:::flyr-pro-addresses-2025",
        "arn:aws:s3:::flyr-pro-addresses-2025/*"
      ]
    }
  ]
}
```

## Step 2: Connect and Setup

```bash
# SSH to instance
ssh -i ~/.ssh/your-key.pem ubuntu@<instance-ip>

# Update system
sudo apt update && sudo apt upgrade -y

# Install Python and dependencies
sudo apt install -y python3-pip python3-venv awscli

# Install DuckDB and boto3
pip3 install duckdb boto3

# Verify installation
python3 -c "import duckdb; print(duckdb.__version__)"
```

## Step 3: Prepare Extraction Environment

```bash
# Create working directory
mkdir -p ~/overture-extraction
cd ~/overture-extraction

# Create directories
mkdir -p scripts /mnt/ebs/temp

# Copy scripts from local (or create them)
# Option A: SCP from local
# scp -i ~/.ssh/your-key.pem scripts/extract_overture_na.py scripts/regions.json ubuntu@<ip>:~/overture-extraction/scripts/

# Option B: Create files directly with nano/vim
nano scripts/extract_overture_na.py
nano scripts/regions.json
```

## Step 4: Test with Single Region

Before running the full extraction, test with a small region:

```bash
cd ~/overture-extraction

# Dry-run Prince Edward Island (smallest region)
python3 scripts/extract_overture_na.py \
  --regions PE \
  --themes buildings \
  --dry-run \
  --ssd-path /mnt/ebs/temp/test.db

# Actual extraction of PE
python3 scripts/extract_overture_na.py \
  --regions PE \
  --themes buildings \
  --ssd-path /mnt/ebs/temp/test.db
```

Verify output:
```bash
aws s3 ls s3://flyr-pro-addresses-2025/overture_extracts/buildings/release=2026-01-21.0/region=PE/ --recursive
```

## Step 5: Launch Full North American Extraction

### Option A: Background with nohup (Recommended)

```bash
cd ~/overture-extraction

# Clean up any old temp files
rm -f /mnt/ebs/temp/*.db /mnt/ebs/temp/*.parquet

# Launch full extraction in background
nohup python3 scripts/extract_overture_na.py \
  --release 2026-01-21.0 \
  --ssd-path /mnt/ebs/temp/na_extract.db \
  --themes buildings roads divisions \
  > na_extraction.log 2>&1 &

# Monitor progress
tail -f na_extraction.log
```

### Option B: tmux Session (Better for disconnect/reconnect)

```bash
# Install tmux if needed
sudo apt install -y tmux

# Create new session
tmux new -s overture-extraction

# Inside tmux session
cd ~/overture-extraction
python3 scripts/extract_overture_na.py \
  --release 2026-01-21.0 \
  --ssd-path /mnt/ebs/temp/na_extract.db \
  --themes buildings roads divisions

# Detach: Ctrl+B, then D
# Reattach later: tmux attach -t overture-extraction
```

## Step 6: Monitor Progress

```bash
# Watch log in real-time
tail -f ~/overture-extraction/na_extraction.log

# Check S3 for new files
aws s3 ls s3://flyr-pro-addresses-2025/overture_extracts/ --recursive | wc -l

# Check specific region progress
aws s3 ls s3://flyr-pro-addresses-2025/overture_extracts/buildings/release=2026-01-21.0/region=ON/ --recursive | head -20
```

## Step 7: Verify Extraction

Once complete, verify the data:

```bash
# Count total parquet files
aws s3 ls s3://flyr-pro-addresses-2025/overture_extracts/ --recursive | grep ".parquet" | wc -l

# Sample query with DuckDB
duckdb -c "
  SELECT 
    'buildings' as theme,
    COUNT(*) as count,
    COUNT(DISTINCT region) as regions
  FROM read_parquet(
    's3://flyr-pro-addresses-2025/overture_extracts/buildings/release=2026-01-21.0/*/*/*/*.parquet',
    hive_partitioning=1
  )
  UNION ALL
  SELECT 
    'roads' as theme,
    COUNT(*) as count,
    COUNT(DISTINCT region) as regions
  FROM read_parquet(
    's3://flyr-pro-addresses-2025/overture_extracts/roads/release=2026-01-21.0/*/*/*/*.parquet',
    hive_partitioning=1
  );
"
```

## Step 8: Update Lambda Environment Variables

After extraction is complete, update your Lambda function:

```bash
# Using AWS CLI
aws lambda update-function-configuration \
  --function-name flyr-slice-lambda \
  --environment "Variables={
    EXTRACT_BUCKET=flyr-pro-addresses-2025,
    EXTRACT_PREFIX=overture_extracts,
    OVERTURE_RELEASE=2026-01-21.0,
    SNAPSHOT_BUCKET=your-snapshot-bucket,
    SLICE_SHARED_SECRET=your-secret
  }"
```

Or via AWS Console:
1. Go to Lambda > Functions > flyr-slice-lambda
2. Configuration > Environment variables
3. Set:
   - `EXTRACT_BUCKET`: flyr-pro-addresses-2025
   - `EXTRACT_PREFIX`: overture_extracts
   - `OVERTURE_RELEASE`: 2026-01-21.0

## Troubleshooting

### Issue: Out of Memory

```bash
# Monitor memory usage
free -h

# Check if swap is enabled
sudo swapon --show

# Create swap file if needed
sudo fallocate -l 16G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

### Issue: Disk Space

```bash
# Monitor disk usage
df -h

# Clean up if needed
rm -f /mnt/ebs/temp/*.db /mnt/ebs/temp/*.parquet
```

### Issue: S3 Permissions

```bash
# Test AWS credentials
aws sts get-caller-identity

# Test S3 access
aws s3 ls s3://flyr-pro-addresses-2025/
aws s3 ls s3://overturemaps-us-west-2/
```

### Issue: Extraction Fails for Specific Region

If one region fails, re-run just that region:

```bash
python3 scripts/extract_overture_na.py \
  --regions CA \
  --themes buildings roads divisions \
  --ssd-path /mnt/ebs/temp/ca_fix.db
```

## Cost Optimization

### EC2 Costs (One-time extraction)
- m6i.2xlarge @ $0.384/hour × 6 hours = ~$2.30

### S3 Storage (Monthly)
- 200 GB × $0.023/GB = ~$4.60/month

### Lambda (Per-query)
- 512 MB memory, 5 second execution = ~$0.0001 per query
- 10,000 queries = ~$1.00

### Total First Month
- EC2: $2.30 (one-time)
- S3: $4.60
- Lambda: ~$1.00 (estimated usage)
- **Total: ~$7.90**

## Cleanup After Extraction

```bash
# Terminate EC2 instance when done (saves ~$276/month)
aws ec2 terminate-instances --instance-ids <instance-id>

# Or stop if you want to re-run later
aws ec2 stop-instances --instance-ids <instance-id>
```

## Appendix: Parallel Extraction Strategy

For faster extraction, split regions across multiple EC2 instances:

**Instance 1**: Western US + Western Canada
```bash
python3 scripts/extract_overture_na.py \
  --regions CA OR WA NV AZ AK HI BC AB YT \
  --themes buildings roads divisions
```

**Instance 2**: Central US + Central Canada
```bash
python3 scripts/extract_overture_na.py \
  --regions TX CO UT NM MT WY ID ND SD NE KS OK MN IA MO WI MI IL IN OH \
  --themes buildings roads divisions
```

**Instance 3**: Eastern US + Eastern Canada
```bash
python3 scripts/extract_overture_na.py \
  --regions NY PA NJ CT RI MA VT NH ME MD DE DC VA WV KY TN NC SC GA FL AL MS LA \
  --themes buildings roads divisions
```

**Instance 4**: Eastern Canada
```bash
python3 scripts/extract_overture_na.py \
  --regions ON QC NB NS PE NL NT NU \
  --themes buildings roads divisions
```

This parallel approach can complete the full extraction in ~2 hours instead of 6-8 hours.
