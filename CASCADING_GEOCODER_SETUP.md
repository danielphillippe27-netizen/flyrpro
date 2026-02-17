# Cascading Geocoder Setup Guide

This guide walks you through setting up the complete Cascading Geocoder pipeline.

## Overview

The pipeline consists of:
1. **Database Layer** - Two-tier PostGIS tables (Gold/Silver) with resolution functions
2. **Ingestion Layer** - ArcGIS scraping to S3
3. **Sync Layer** - S3 to PostGIS data loading
4. **Automation Layer** - GitHub Actions for monthly updates

## Step 1: Database Setup

### 1.1 Run the Migration

Execute the SQL migration in Supabase SQL Editor or via psql:

```bash
psql $DATABASE_URL -f supabase/migrations/20260217000000_cascading_geocoder_schema.sql
```

### 1.2 Verify Setup

```sql
-- Check tables were created
\dt ref_addresses_*

-- Check the resolution function exists
\df resolve_address_point

-- Test the function
SELECT resolve_address_point('123', 'Main Street', 'Oshawa', 'ON', 'L1G4T8');
```

## Step 2: AWS S3 Setup

### 2.1 Create S3 Bucket (if not exists)

```bash
aws s3 mb s3://flyr-pro-data --region us-east-1
```

### 2.2 Create Folder Structure

```bash
aws s3api put-object --bucket flyr-pro-data --key addresses/priority-gold/
aws s3api put-object --bucket flyr-pro-data --key addresses/backup-silver/
```

### 2.3 Configure IAM User

Create an IAM user with the following policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::flyr-pro-data",
        "arn:aws:s3:::flyr-pro-data/*"
      ]
    }
  ]
}
```

Save the Access Key ID and Secret Access Key.

## Step 3: GitHub Actions Setup

### 3.1 Navigate to Secrets

1. Go to your GitHub repository
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**

### 3.2 Add Required Secrets

| Secret Name | Value | Description |
|-------------|-------|-------------|
| `AWS_ACCESS_KEY_ID` | AKIA... | From IAM user |
| `AWS_SECRET_ACCESS_KEY` | wJalr... | From IAM user |
| `AWS_REGION` | us-east-1 | S3 bucket region |
| `AWS_BUCKET_NAME` | flyr-pro-data | Your bucket name |

### 3.3 Optional: Database Sync Secrets

If you want automatic database sync (uncommented in workflow):

| Secret Name | Value |
|-------------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | https://your-project.supabase.co |
| `SUPABASE_SERVICE_ROLE_KEY` | eyJhbG... |

## Step 4: First Run

### 4.1 Test ArcGIS Ingestion (Local)

```bash
# Set environment variables
export AWS_ACCESS_KEY_ID=your_key
export AWS_SECRET_ACCESS_KEY=your_secret
export AWS_REGION=us-east-1
export AWS_BUCKET_NAME=flyr-pro-data

# List available sources
npx tsx scripts/ingest_municipal_data.ts --list-sources

# Test Durham Region (dry run)
npx tsx scripts/ingest_municipal_data.ts --source=durham_region --dry-run

# Actually ingest
npx tsx scripts/ingest_municipal_data.ts --source=durham_region
```

### 4.2 Verify S3 Upload

```bash
aws s3 ls s3://flyr-pro-data/addresses/priority-gold/
# Should show: durham_on.geojson
```

### 4.3 Sync to Database

```bash
# Set Supabase credentials
export NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=your_key

# Preview sync
npx tsx scripts/sync-gold-addresses-from-s3.ts --source=durham_region --dry-run

# Actually sync
npx tsx scripts/sync-gold-addresses-from-s3.ts --source=durham_region
```

### 4.4 Verify Database

```sql
-- Check data loaded
SELECT COUNT(*) FROM ref_addresses_gold;

-- Check sample record
SELECT * FROM ref_addresses_gold LIMIT 5;

-- Test resolution
SELECT resolve_address_point('123', 'Main Street', 'Oshawa', 'ON');
```

## Step 5: Enable Automation

### 5.1 Test GitHub Actions Workflow

1. Go to **Actions** tab in GitHub
2. Select **Sync Municipal Address Data to S3**
3. Click **Run workflow**
4. Choose:
   - Source: `durham_region` (or leave empty for all)
   - Dry run: ✅ (for first test)

### 5.2 Monitor Run

Watch the workflow execution logs to ensure:
- ArcGIS fetch succeeds
- S3 upload completes
- No errors in logs

### 5.3 Enable Schedule

The workflow is already scheduled (`0 0 1 * *` = 1st of every month).
No additional configuration needed.

## Step 6: Add More Sources

To add York Region or other municipalities:

### 6.1 Find ArcGIS URL

Search for:
- "[Municipality] open data"
- "[Municipality] GIS REST services"
- Look for "Address Points" or "Site Addresses" layer

### 6.2 Update Script

Edit `scripts/ingest_municipal_data.ts`:

```typescript
export const MUNICIPAL_SOURCES: MunicipalSource[] = [
  // ... existing sources ...
  
  {
    name: 'york_region',
    url: 'https://gis.york.ca/arcgis/rest/services/YRC_AddressPoints/FeatureServer/0',
    s3Key: 'addresses/priority-gold/york_on.geojson',
    description: 'York Region Address Points',
    province: 'ON',
  },
];
```

### 6.3 Test New Source

```bash
npx tsx scripts/ingest_municipal_data.ts --source=york_region --dry-run
```

### 6.4 Commit and Push

```bash
git add scripts/ingest_municipal_data.ts
git commit -m "Add York Region to municipal data sources"
git push
```

## Troubleshooting

### "Address not found" errors

```sql
-- Check if Gold table has data for that area
SELECT DISTINCT city, province, COUNT(*) 
FROM ref_addresses_gold 
GROUP BY city, province;

-- Check specific address pattern
SELECT * FROM ref_addresses_gold 
WHERE street_name_normalized LIKE '%main%';
```

### ArcGIS pagination fails

Test the service URL directly:
```bash
curl "https://services.example.com/arcgis/rest/services/Addresses/FeatureServer/0/query?f=json&where=1=1&returnCountOnly=true"
```

### S3 permission errors

Verify IAM policy includes:
- `s3:PutObject` for uploads
- `s3:GetObject` for downloads
- `s3:ListBucket` for listing

### Database connection errors

Check:
1. Supabase URL is correct
2. Service role key has proper permissions
3. Database migration was applied
4. IP allowlist includes your machine (if running locally)

## Maintenance

### Monthly
- GitHub Actions runs automatically
- Check logs for any failures
- Verify data freshness

### Quarterly
- Review sync logs: `SELECT * FROM ref_addresses_sync_log ORDER BY sync_completed_at DESC;`
- Check table stats: `SELECT * FROM v_address_reference_stats;`
- Consider adding new municipalities

### Annually
- Review Silver table partitioning strategy
- Evaluate if additional indexes needed
- Update ArcGIS URLs if services change

## Next Steps

1. **Load Silver Data**: Consider loading OpenAddresses or Statistics Canada bulk data
2. **Monitoring**: Set up alerts for failed GitHub Actions runs
3. **Caching**: Add Redis cache for frequently resolved addresses
4. **API**: Expose resolution function via REST API endpoint
