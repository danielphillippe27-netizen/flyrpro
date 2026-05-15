# Cascading Geocoder Pipeline

A Tiered Address Resolution System for fixing "soldier line" interpolation issues in canvassing applications using PostGIS and AWS S3.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CASCADING GEOCODER PIPELINE                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────────┐   │
│  │  ArcGIS Servers │────▶│   AWS S3        │────▶│   PostGIS           │   │
│  │  (Municipal)    │     │  priority-gold/ │     │  ref_addresses_gold │   │
│  └─────────────────┘     └─────────────────┘     └─────────────────────┘   │
│          │                        │                      │                  │
│          │                        │                      │                  │
│          ▼                        ▼                      ▼                  │
│   ┌─────────────┐          ┌─────────────┐      ┌─────────────────┐        │
│   │ GitHub      │          │  backup-    │      │ ref_addresses_  │        │
│   │ Actions     │          │  silver/    │      │ silver          │        │
│   │ (monthly)   │          │  (160M+)    │      │ (partitioned)   │        │
│   └─────────────┘          └─────────────┘      └─────────────────┘        │
│                                                             │               │
└─────────────────────────────────────────────────────────────┼───────────────┘
                                                              │
                                                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      ADDRESS RESOLUTION FUNCTION                              │
│                                                                             │
│   resolve_address_point(search_num, search_street, search_city, search_zip) │
│                                                                             │
│   ┌─────────────┐                                                           │
│   │   INPUT     │  1. Normalize input (remove "St", "Ave", lower-case)      │
│   └──────┬──────┘                                                           │
│          │                                                                  │
│          ▼                                                                  │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  PASS 1: GOLD                                                       │   │
│   │  ├─ Query ref_addresses_gold (200k rows, heavily indexed)          │   │
│   │  ├─ Exact match on normalized street_number + street_name          │   │
│   │  ├─ Fallback to trigram fuzzy matching if needed                   │   │
│   │  └─ Return: {source: 'gold', precision: 'rooftop', confidence: 1.0}│   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│          │                                                                  │
│          │  If not found...                                                  │
│          ▼                                                                  │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  PASS 2: SILVER                                                     │   │
│   │  ├─ Query ref_addresses_silver (160M+ rows, partitioned)           │   │
│   │  ├─ Same matching logic                                             │   │
│   │  └─ Return: {source: 'silver', precision: 'interpolated', conf: 0.7}│   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│          │                                                                  │
│          ▼                                                                  │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  OUTPUT                                                             │   │
│   │  {                                                                  │   │
│   │    found: true/false,                                               │   │
│   │    geometry: {type: "Point", coordinates: [lon, lat]},              │   │
│   │    source: "gold" | "silver" | null,                                │   │
│   │    precision: "rooftop" | "interpolated" | null,                    │   │
│   │    confidence: 0.0-1.0,                                             │   │
│   │    metadata: {...}                                                  │   │
│   │  }                                                                  │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Why This Architecture?

### Speed
Your app will usually find the address in the "Gold" table (which is small, maybe 200k rows for Durham). It scans that instantly. It only looks at the massive 160M table if it fails.

### Maintainability
When Durham releases a 2026 update, you just drop/truncate the `ref_addresses_gold` table and re-sync the S3 bucket. You don't have to rebuild the massive global table.

### Cost
You don't query the massive table for every single request, saving CPU cycles on your database.

## Database Schema

### ref_addresses_gold (High-Quality Municipal Data)

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `street_number` | TEXT | Raw street number (e.g., "123A") |
| `street_number_normalized` | INTEGER | Generated: numeric part only |
| `street_name` | TEXT | Raw street name |
| `street_name_normalized` | TEXT | Generated: lowercase, no special chars |
| `unit` | TEXT | Apartment/suite number |
| `city` | TEXT | Municipality |
| `province` | TEXT | Province/State code |
| `postal_code` | TEXT | Raw postal code |
| `postal_code_normalized` | TEXT | Generated: uppercase, no spaces |
| `geom` | GEOMETRY(Point, 4326) | Precise rooftop location |
| `source_file` | TEXT | S3 key (e.g., "durham_on.geojson") |
| `source_name` | TEXT | Source identifier (e.g., "durham_region") |
| `source_url` | TEXT | ArcGIS service URL |
| `source_date` | DATE | When data was published |
| `precision` | TEXT | 'rooftop', 'entrance', 'driveway' |
| `created_at` | TIMESTAMPTZ | Record creation time |
| `updated_at` | TIMESTAMPTZ | Last update time |

**Indexes:**
- `idx_ref_gold_geom` - GIST spatial index
- `idx_ref_gold_street_name` - B-tree on normalized street
- `idx_ref_gold_lookup` - Composite (street, number, city, province)
- `idx_ref_gold_street_trgm` - GIN trigram for fuzzy matching

### ref_addresses_silver (Bulk Interpolated Data)

Same schema as Gold, but:
- Partitioned by `province` (ON, BC, AB, etc.)
- Uses BRIN index for geometry (efficient for large datasets)
- 160M+ rows expected

**Partitions:**
- `ref_addresses_silver_on` - Ontario
- `ref_addresses_silver_bc` - British Columbia
- `ref_addresses_silver_ab` - Alberta
- ... etc for all provinces

## SQL Functions

### resolve_address_point

Main geocoding function with two-pass resolution:

```sql
SELECT resolve_address_point(
    '123',           -- street_number
    'Main Street',   -- street_name
    'Oshawa',        -- city
    'ON',            -- province
    'L1G4T8'         -- postal_code (optional)
);
```

Returns:
```json
{
  "found": true,
  "source": "gold",
  "precision": "rooftop",
  "confidence": 1.0,
  "address": {
    "street_number": "123",
    "street_name": "Main Street",
    "city": "Oshawa",
    "province": "ON",
    "postal_code": "L1G4T8"
  },
  "geometry": {
    "type": "Point",
    "coordinates": [-78.8652, 43.8971]
  },
  "metadata": {
    "source_name": "durham_region",
    "matched_via": "exact_match"
  }
}
```

### resolve_campaign_addresses

Bulk resolution for all addresses in a campaign:

```sql
-- Dry run to preview changes
SELECT * FROM resolve_campaign_addresses('campaign-uuid-here', true);

-- Actually update the addresses
SELECT * FROM resolve_campaign_addresses('campaign-uuid-here', false);
```

## Scripts

### 1. ingest_municipal_data.ts

Scrapes ArcGIS Feature Servers and uploads to S3.

```bash
# List available sources
npx tsx scripts/ingest_municipal_data.ts --list-sources

# Ingest specific source
npx tsx scripts/ingest_municipal_data.ts --source=durham_region

# Dry run (fetch but don't upload)
npx tsx scripts/ingest_municipal_data.ts --source=durham_region --dry-run

# Ingest all sources
npx tsx scripts/ingest_municipal_data.ts --all-sources
```

**Adding New Sources:**

Edit `MUNICIPAL_SOURCES` array in the script:

```typescript
const MUNICIPAL_SOURCES: MunicipalSource[] = [
  {
    name: 'durham_region',
    url: 'https://services3.arcgis.com/.../FeatureServer/0',
    s3Key: 'addresses/priority-gold/durham_on.geojson',
    description: 'Durham Region Site Address Points',
    province: 'ON',
  },
  // Add your new source here:
  {
    name: 'york_region',
    url: 'https://gis.york.ca/arcgis/rest/services/YRC_AddressPoints/FeatureServer/0',
    s3Key: 'addresses/priority-gold/york_on.geojson',
    description: 'York Region Address Points',
    province: 'ON',
  },
];
```

### 2. sync-gold-addresses-from-s3.ts

Downloads from S3 and upserts into PostGIS.

```bash
# List available sources
npx tsx scripts/sync-gold-addresses-from-s3.ts --list-sources

# Sync specific source
npx tsx scripts/sync-gold-addresses-from-s3.ts --source=durham_region

# Dry run (preview without database changes)
npx tsx scripts/sync-gold-addresses-from-s3.ts --source=durham_region --dry-run

# Sync all sources
npx tsx scripts/sync-gold-addresses-from-s3.ts --all-sources
```

## GitHub Actions Workflow

Automatic monthly sync (`.github/workflows/sync_addresses.yml`):

**Schedule:** 1st of every month at midnight UTC

**Manual Trigger:** Via GitHub UI with options:
- Specific source or all sources
- Dry run mode

**Required Secrets:**
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION` (optional, defaults to us-east-1)
- `AWS_BUCKET_NAME` (optional, defaults to flyr-pro-data)

## Environment Setup

### Required Environment Variables

```bash
# AWS (for S3 access)
export AWS_ACCESS_KEY_ID=your_key_here
export AWS_SECRET_ACCESS_KEY=your_secret_here
export AWS_REGION=us-east-1
export AWS_BUCKET_NAME=flyr-pro-data

# Supabase (for database sync)
export NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### S3 Bucket Structure

```
s3://flyr-pro-data/
├── addresses/
│   ├── priority-gold/           # Municipal data (high quality)
│   │   ├── durham_on.geojson
│   │   ├── york_on.geojson
│   │   └── toronto_on.geojson
│   └── backup-silver/           # Bulk data (160M+ addresses)
│       └── openaddresses_ca.parquet
```

## Monitoring

### View Sync Status

```sql
-- Latest sync operations
SELECT * FROM ref_addresses_sync_log 
ORDER BY sync_completed_at DESC 
LIMIT 10;

-- Table statistics
SELECT * FROM v_address_reference_stats;
```

### Gold Table Stats

```sql
SELECT 
    source_name,
    COUNT(*) as address_count,
    COUNT(DISTINCT city) as cities,
    MAX(source_date) as latest_data
FROM ref_addresses_gold
GROUP BY source_name;
```

## Troubleshooting

### "Address not found" issues

1. Check if the source data is in S3:
   ```bash
   aws s3 ls s3://flyr-pro-data/addresses/priority-gold/
   ```

2. Check if data is synced to database:
   ```sql
   SELECT COUNT(*) FROM ref_addresses_gold WHERE source_name = 'durham_region';
   ```

3. Test the resolution function directly:
   ```sql
   SELECT resolve_address_point('123', 'Main St', 'Oshawa', 'ON');
   ```

### ArcGIS pagination issues

If a source returns incomplete data:
- Check the ArcGIS service URL in a browser
- Try accessing `/query?f=json&where=1=1&returnCountOnly=true` to get total count
- Check service documentation for max record count limits

### Database performance

If Gold queries are slow:
```sql
-- Check if indexes exist
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'ref_addresses_gold';

-- Analyze table for query planner
ANALYZE ref_addresses_gold;
```

## Future Enhancements

1. **Silver Table Population**: Add script to load OpenAddresses or similar bulk datasets
2. **Real-time Sync**: Webhook-based updates when municipalities publish changes
3. **Confidence Scoring**: ML-based confidence based on address pattern matching
4. **Address Validation**: Additional validation against Canada Post or similar
5. **Multi-language**: Support for French street names in Quebec

## References

- [PostGIS Documentation](https://postgis.net/documentation/)
- [pg_trgm Documentation](https://www.postgresql.org/docs/current/pgtrgm.html)
- [ArcGIS REST API](https://developers.arcgis.com/rest/services-reference/enterprise/query-feature-service-layer/)
- [OpenAddresses](https://openaddresses.io/) - Potential Silver data source
