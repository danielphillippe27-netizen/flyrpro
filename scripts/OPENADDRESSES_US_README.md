# OpenAddresses US Data Ingestion

This script downloads US address data from [OpenAddresses](https://www.openaddresses.io/) and organizes it in S3 by state for efficient regional loading.

## The "Goldilocks" Approach

Instead of managing 50+ individual state downloads or one massive US file, we use **4 regional bundles** from OpenAddresses:

| Region | States | Bundle Size | Est. Time |
|--------|--------|-------------|-----------|
| Northeast | ME, NH, VT, MA, RI, CT, NY, NJ, PA | ~641 MB | ~5 min |
| South | DE, MD, DC, VA, WV, KY, TN, NC, SC, GA, FL, AL, MS, AR, LA, OK, TX | ~2.5 GB | ~15 min |
| Midwest | OH, MI, IN, WI, IL, MN, IA, MO, ND, SD, NE, KS | ~973 MB | ~8 min |
| West | MT, ID, WY, NV, UT, CO, AZ, NM, WA, OR, CA, AK, HI | ~1.1 GB | ~10 min |

**Total: ~5.2 GB for all US addresses**

**Benefits:**
- ✅ Simple script (only 4 URLs to manage)
- ✅ Granular state-level output for efficient regional queries
- ✅ Can load just Texas (~2GB) instead of entire South (~20GB)

## S3 Output Structure

```
s3://flyr-pro-data/silver/us/ny/addresses.csv     # New York
s3://flyr-pro-data/silver/us/tx/addresses.csv     # Texas
s3://flyr-pro-data/silver/us/ca/addresses.csv     # California
...
```

## Prerequisites

1. AWS credentials with S3 write access
2. Node.js and npm packages installed

```bash
# Install dependencies if not already installed
npm install @aws-sdk/client-s3 @aws-sdk/lib-storage jszip axios
```

## Usage

### Basic Usage (Process All Regions)

```bash
export AWS_ACCESS_KEY_ID=your_key
export AWS_SECRET_ACCESS_KEY=your_secret
export AWS_REGION=us-east-1
export AWS_BUCKET_NAME=flyr-pro-data

npx tsx scripts/ingest_openaddresses_us.ts
```

### Process Specific Regions Only

```bash
# Process only northeast and west
npx tsx scripts/ingest_openaddresses_us.ts northeast west
```

### Dry Run (Preview Without Uploading)

```bash
npx tsx scripts/ingest_openaddresses_us.ts --dry-run
```

## How It Works

1. **Download**: Downloads the regional ZIP file from OpenAddresses S3
2. **Extract**: Loads ZIP into memory and finds `statewide.csv` files
3. **Filter**: Only processes statewide files (ignores county-level files)
4. **Transform**: Renames files from `us/ny/statewide.csv` → `{state}/addresses.csv`
5. **Upload**: Streams each state's CSV directly to S3 with metadata

## Statewide vs County Files

OpenAddresses bundles contain both:
- **statewide.csv** - Complete state address data (what we want)
- **county/city files** - Individual county data (ignored)

Example ZIP contents:
```
us/ny/statewide.csv          ✅ KEPT → silver/us/ny/addresses.csv
us/ny/city_of_buffalo.csv    ❌ IGNORED (already in statewide)
us/ny/albany_county.csv      ❌ IGNORED (already in statewide)
```

## Expected Runtime

| Region | Download | Process | Upload | Total |
|--------|----------|---------|--------|-------|
| Northeast | ~2 min | ~1 min | ~1 min | ~4 min |
| South | ~8 min | ~3 min | ~3 min | ~14 min |
| Midwest | ~3 min | ~1 min | ~1 min | ~5 min |
| West | ~4 min | ~2 min | ~2 min | ~8 min |

**Total for all 4 regions: ~30 minutes**

## Monitoring Progress

The script shows real-time progress:
```
📥 Downloading south bundle from OpenAddresses...
  Progress: 45% (8.2 GB / 18.1 GB)

📦 Extracting ZIP archive...
  ✓ ZIP loaded in 2m 15s

📄 Files in archive: 1,247
  ✓ Found: us/tx/statewide.csv (2.1 GB) -> tx
  ✓ Found: us/fl/statewide.csv (1.8 GB) -> fl
  ...

☁️  Uploading state files to S3...
  📤 Uploading Texas (TX)...
     Upload: 67%
```

## Troubleshooting

### "Memory Error" During Extraction

The South region (~2.5 GB) is the largest but should fit in memory on most modern systems. If you encounter memory issues:

```bash
# Increase Node.js memory limit
node --max-old-space-size=16384 node_modules/.bin/tsx scripts/ingest_openaddresses_us.ts south
```

Or process regions one at a time:
```bash
npx tsx scripts/ingest_openaddresses_us.ts northeast
npx tsx scripts/ingest_openaddresses_us.ts midwest
npx tsx scripts/ingest_openaddresses_us.ts west
npx tsx scripts/ingest_openaddresses_us.ts south  # Do this one last
```

### Download Timeouts

Large regions may timeout on slow connections. The script has a 30-minute timeout, but you can modify it in the code if needed.

### S3 Upload Failures

If upload fails partway through:
1. Check AWS credentials
2. Verify bucket exists and you have write permissions
3. Check S3 bucket policy allows uploads

## Verify Upload

After completion, verify states were uploaded:

```bash
# List all states in S3
aws s3 ls s3://flyr-pro-data/silver/us/

# Check specific state
aws s3 ls s3://flyr-pro-data/silver/us/ny/
aws s3 head-object --bucket flyr-pro-data --key silver/us/ny/addresses.csv
```

## Using the Data

Once uploaded, you can query specific states using DuckDB:

```sql
-- Query New York addresses
SELECT * FROM read_csv_auto('s3://flyr-pro-data/silver/us/ny/addresses.csv')
WHERE lon BETWEEN -74.3 AND -73.7
  AND lat BETWEEN 40.4 AND 40.9;
```

Or load into Supabase for a campaign:

```bash
npx tsx scripts/load-regional-data.ts --campaign=<campaign_id>
```

## Data Freshness

OpenAddresses updates their bundles periodically. To refresh data:

1. Re-run the script (it will overwrite existing files)
2. Check OpenAddresses [status page](http://results.openaddresses.io/) for update dates

## Cost Estimate

| Item | Amount | Monthly Cost |
|------|--------|--------------|
| S3 Storage (~50GB) | $0.023/GB | ~$1.15 |
| Data Transfer (if egress) | $0.09/GB | Depends on usage |

## Related Scripts

- `ingest_silver_canada.ts` - Similar script for Canadian StatCan data
- `load-regional-data.ts` - Loads S3 data into Supabase for campaigns
- `sync-gold-addresses-from-s3.ts` - Syncs priority gold data to Supabase
