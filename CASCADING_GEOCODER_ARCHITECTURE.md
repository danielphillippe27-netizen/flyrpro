# Cascading Geocoder - Federated Architecture

## Overview

This architecture uses a **federated** approach where:
- **S3** is the data lake (160M addresses + Overture buildings)
- **Supabase** is the hot cache (regional subsets loaded on-demand)
- **Gold tier** is municipal data (Durham, etc.) always loaded

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATA SOURCES                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌─────────────────────┐     ┌─────────────────────┐                       │
│   │   S3 Data Lake      │     │   ArcGIS Servers    │                       │
│   │                     │     │   (Municipal)       │                       │
│   │  160M addresses     │     │                     │                       │
│   │  ├─ na_addresses.parquet   ├─ Durham Region    │                       │
│   │  └─ (Silver raw)    │     │  ├─ Site Address   │                       │
│   │                     │     │  │   Points        │                       │
│   │  Overture buildings │     │  └─ (rooftop)      │                       │
│   │  ├─ na_buildings.parquet   ├─ York Region      │                       │
│   │  └─ (footprints)    │     │  └─ Address Points │                       │
│   │                     │     │                     │                       │
│   │  Stored: ~50GB      │     │  Frequency:        │                       │
│   │  Cost: $1-2/month   │     │  Monthly refresh   │                       │
│   └─────────────────────┘     └─────────────────────┘                       │
│            │                           │                                    │
│            │                           │                                    │
│            ▼                           ▼                                    │
│   ┌─────────────────────┐     ┌─────────────────────┐                       │
│   │   On-Demand Load    │     │   GitHub Actions    │                       │
│   │   (Node.js/DuckDB)  │     │   (Monthly)         │                       │
│   │                     │     │                     │                       │
│   │  User selects area  │     │  ingest_municipal_  │                       │
│   │         │           │     │  data.ts            │                       │
│   │         ▼           │     │         │           │                       │
│   │  ┌─────────────┐    │     │         ▼           │                       │
│   │  │ DuckDB      │    │     │  ┌─────────────┐    │                       │
│   │  │ queries S3  │    │     │  │ Fetch from  │    │                       │
│   │  │ with spatial│    │     │  │ ArcGIS      │    │                       │
│   │  │ filter      │    │     │  │ (paginated) │    │                       │
│   │  └──────┬──────┘    │     │  └──────┬──────┘    │                       │
│   │         │           │     │         │           │                       │
│   │         ▼           │     │         ▼           │                       │
│   │  ┌─────────────┐    │     │  ┌─────────────┐    │                       │
│   │  │ Stream to   │    │     │  │ Upload to   │    │                       │
│   │  │ Supabase    │    │     │  │ S3          │    │                       │
│   │  │ (PostGIS)   │    │     │  │ (priority-  │    │                       │
│   │  └─────────────┘    │     │  │  gold/)     │    │                       │
│   └─────────────────────┘     └─────────────────────┘                       │
│            │                           │                                    │
│            └───────────┬───────────────┘                                    │
│                        │                                                    │
│                        ▼                                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                      SUPABASE / POSTGIS                             │   │
│   │                                                                     │   │
│   │  ┌─────────────────────┐    ┌─────────────────────┐                 │   │
│   │  │   ref_addresses_    │    │   ref_addresses_    │                 │   │
│   │  │   gold              │    │   silver            │                 │   │
│   │  │                     │    │                     │                 │   │
│   │  │  Municipal data     │    │  Regional subset    │                 │   │
│   │  │  ├─ Durham: 200k    │    │  from S3 data lake  │                 │   │
│   │  │  ├─ York: 300k      │    │                     │                 │   │
│   │  │  └─ Toronto: 500k   │    │  Loaded per         │                 │   │
│   │  │                     │    │  campaign area      │                 │   │
│   │  │  Always present     │    │                     │                 │   │
│   │  │  Heavily indexed    │    │  └─ Campaign A: 50k │                 │   │
│   │  │                     │    │  └─ Campaign B: 30k │                 │   │
│   │  │  Precision:         │    │                     │                 │   │
│   │  │  rooftop            │    │  Precision:         │                 │   │
│   │  │                     │    │  interpolated       │                 │   │
│   │  └─────────────────────┘    └─────────────────────┘                 │   │
│   │                                                                     │   │
│   │  ┌─────────────────────┐    ┌─────────────────────┐                 │   │
│   │  │   overture_buildings│    │   campaign_addresses│                 │   │
│   │  │                     │    │                     │                 │   │
│   │  │  Regional subset    │    │  User's target      │                 │   │
│   │  │  from S3            │    │  addresses          │                 │   │
│   │  │                     │    │                     │                 │   │
│   │  │  Loaded per         │    │  Resolved via       │                 │   │
│   │  │  campaign area      │    │  resolve_address_   │                 │   │
│   │  │                     │    │  point_v2()         │                 │   │
│   │  │  Used for:          │    │                     │                 │   │
│   │  │  - Building         │    │  Gold → Silver      │                 │   │
│   │  │    matching         │    │  fallback           │                 │   │
│   │  │  - 3D rendering     │    │                     │                 │   │
│   │  └─────────────────────┘    └─────────────────────┘                 │   │
│   │                                                                     │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│                              ▼                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                      RESOLUTION ENGINE                              │   │
│   │                                                                     │   │
│   │   resolve_address_point_v2(search_num, search_street, city, ...)    │   │
│   │                                                                     │   │
│   │   ┌─────────────┐                                                   │   │
│   │   │   INPUT     │  "123 Main St, Oshawa, ON"                         │   │
│   │   └──────┬──────┘                                                   │   │
│   │          │                                                          │   │
│   │          ▼                                                          │   │
│   │   ┌─────────────────────────────────────────────────────────────┐   │   │
│   │   │ PASS 1: GOLD                                                │   │   │
│   │   │ SELECT * FROM ref_addresses_gold                            │   │   │
│   │   │ WHERE street = 'Main St' AND number = 123                   │   │   │
│   │   │         │                                                   │   │   │
│   │   │         ▼                                                   │   │   │
│   │   │   FOUND? ──YES──▶ Return {source: 'gold', precision: 'rooftop'}│   │   │
│   │   │         │                                                   │   │   │
│   │   │         NO                                                  │   │   │
│   │   └─────────┼───────────────────────────────────────────────────┘   │   │
│   │             │                                                       │   │
│   │             ▼                                                       │   │
│   │   ┌─────────────────────────────────────────────────────────────┐   │   │
│   │   │ PASS 2: SILVER                                              │   │   │
│   │   │ SELECT * FROM ref_addresses_silver                        │   │   │
│   │   │ WHERE street = 'Main St' AND number = 123                   │   │   │
│   │   │   AND loaded_for_campaign_id = 'current-campaign'           │   │   │
│   │   │         │                                                   │   │   │
│   │   │         ▼                                                   │   │   │
│   │   │   FOUND? ──YES──▶ Return {source: 'silver', precision: 'interpolated'}│   │   │
│   │   │         │                                                   │   │   │
│   │   │         NO                                                  │   │   │
│   │   └─────────┼───────────────────────────────────────────────────┘   │   │
│   │             │                                                       │   │
│   │             ▼                                                       │   │
│   │   ┌─────────────────────────────────────────────────────────────┐   │   │
│   │   │ NOT FOUND                                                   │   │   │
│   │   │ Return {found: false, suggestion: 'Load regional data?'}    │   │   │
│   │   └─────────────────────────────────────────────────────────────┘   │   │
│   │                                                                     │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Workflow: User Creates Campaign

```
1. User draws polygon on map / enters address
         │
         ▼
2. Frontend: Create campaign with bbox
         │
         ▼
3. Backend: Call load-regional-data.ts
   ┌─────────────────────────────────────┐
   │  npx tsx scripts/load-regional-data.ts \\n   │    --campaign=<new-campaign-id>     │
   └─────────────────────────────────────┘
         │
         ▼
4. DuckDB queries S3 parquet files
   with spatial filter on bbox
         │
         ▼
5. Stream results to Supabase
   - ref_addresses_silver (regional subset)
   - overture_buildings (regional subset)
         │
         ▼
6. Campaign ready! Resolution uses:
   Gold (if available) → Silver (just loaded)
```

## Key Design Decisions

### Why Not Load Everything?

| Metric | Full Load | Regional On-Demand |
|--------|-----------|-------------------|
| **Storage** | ~500GB | ~5GB average |
| **Query Speed** | Slow (huge tables) | Fast (targeted indexes) |
| **Cost** | $500+/month | $50/month |
| **Cold Start** | None | 30-120s initial load |
| **Scalability** | Limited | Unlimited (S3 backend) |

### Gold vs Silver

| Feature | Gold (Municipal) | Silver (S3 Data Lake) |
|---------|-----------------|----------------------|
| **Source** | ArcGIS servers | 160M bulk dataset |
| **Precision** | Rooftop | Interpolated/Parcel |
| **Update** | Monthly via GitHub Actions | As-needed per campaign |
| **Coverage** | Major cities only | Nationwide |
| **Typical Count** | 200k-500k per city | 10k-100k per campaign area |
| **Priority** | First | Fallback |

## File Structure

```
supabase/migrations/
├── 20260217000000_cascading_geocoder_schema.sql       # Gold table + basic Silver
└── 20260217000001_cascading_geocoder_silver_s3.sql    # S3-loaded Silver + buildings

scripts/
├── ingest_municipal_data.ts        # ArcGIS → S3 (Gold sources)
├── sync-gold-addresses-from-s3.ts  # S3 → Supabase (Gold layer)
└── load-regional-data.ts           # S3 → Supabase (Silver layer, on-demand)

.github/workflows/
└── sync_addresses.yml              # Monthly ArcGIS refresh
```

## Usage

### 1. Initial Setup

```bash
# Run migrations
psql $DATABASE_URL -f supabase/migrations/20260217000000_cascading_geocoder_schema.sql
psql $DATABASE_URL -f supabase/migrations/20260217000001_cascading_geocoder_silver_s3.sql

# Load municipal Gold data
npx tsx scripts/ingest_municipal_data.ts --source=durham_region
npx tsx scripts/sync-gold-addresses-from-s3.ts --source=durham_region
```

### 2. When User Creates Campaign

```typescript
// In your API route
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function onCampaignCreated(campaignId: string, bbox: number[]) {
  // Trigger regional data load
  // This runs async - campaign is ready immediately, data loads in background
  execAsync(`npx tsx scripts/load-regional-data.ts --campaign=${campaignId}`)
    .catch(err => console.error('Regional load failed:', err));
  
  // Return immediately - resolution will use Gold for now
  // Silver data becomes available in 30-120 seconds
  return { status: 'loading', campaignId };
}
```

### 3. Address Resolution

```sql
-- In campaign address processing
UPDATE campaign_addresses ca
SET 
  geom = (resolution->'geometry')::geometry,
  coordinate = resolution->'address',
  metadata = resolution->'metadata'
FROM (
  SELECT 
    id,
    resolve_address_point_v2(
      house_number,
      street_name,
      locality,
      region,
      postal_code,
      campaign_id  -- Restricts to campaign-loaded Silver data
    ) as resolution
  FROM campaign_addresses
  WHERE campaign_id = 'uuid-here'
) r
WHERE ca.id = r.id;
```

## Monitoring

```sql
-- Check campaign data coverage
SELECT * FROM v_campaign_data_coverage 
WHERE campaign_id = 'uuid-here';

-- Check load status
SELECT 
  campaign_id,
  data_type,
  records_loaded,
  load_status,
  load_duration_ms / 1000 as duration_seconds
FROM regional_data_load_log
ORDER BY started_at DESC
LIMIT 10;

-- Gold vs Silver resolution rates
SELECT 
  metadata->>'tier' as tier,
  COUNT(*) as count,
  COUNT(*) * 100.0 / SUM(COUNT(*)) OVER () as pct
FROM campaign_addresses
WHERE geom IS NOT NULL
GROUP BY metadata->>'tier';
```

## Cost Estimates

| Component | Monthly Cost |
|-----------|-------------|
| S3 Storage (50GB) | ~$1.15 |
| S3 Requests | ~$0.50 |
| Supabase DB (8GB) | ~$25 |
| GitHub Actions | Free (public repo) |
| **Total** | **~$27/month** |

vs. storing 160M addresses in Supabase directly: ~$500+/month

## Next Steps

1. **Test regional load** with a small bbox first
2. **Add more Gold sources** (York, Toronto, Peel)
3. **Optimize DuckDB queries** with partitioning if needed
4. **Add progress tracking** for large loads
5. **Consider caching** frequently accessed regions
