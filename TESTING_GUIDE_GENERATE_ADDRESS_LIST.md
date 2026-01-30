# Testing Guide: Generate Address List Endpoint

## Prerequisites

1. **Run the migration** to add `source_id` column:
   ```bash
   # If using Supabase CLI
   supabase migration up
   
   # Or apply manually via Supabase dashboard SQL editor
   # Copy contents of: supabase/migrations/20251208000003_add_source_id_to_campaign_addresses.sql
   ```

2. **Environment Variables** (in `.env.local`):
   ```bash
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   NEXT_PUBLIC_MAPBOX_TOKEN=your_mapbox_token
   MOTHERDUCK_TOKEN=your_motherduck_token  # Optional - will use local DuckDB if not set
   ```

3. **Create or get a Campaign ID**:
   - Create a campaign via your app, or
   - Get an existing campaign ID from Supabase:
     ```sql
     SELECT id, name FROM campaigns LIMIT 1;
     ```

## Step 2: Start Your Dev Server

```bash
npm run dev
# Server should start on http://localhost:3000
```

## Step 3: Run the Smoke Test

### Option A: Using Environment Variables

```bash
# Set required env vars
export CAMPAIGN_ID="your-campaign-uuid-here"
export STARTING_ADDRESS="123 Main St, San Francisco, CA"
export COUNT=10  # Optional, defaults to 10

# Run the test
npx tsx scripts/generate-address-list-smoke.ts
```

### Option B: Using .env.local

Add to your `.env.local`:
```bash
CAMPAIGN_ID=your-campaign-uuid-here
STARTING_ADDRESS="123 Main St, San Francisco, CA"
COUNT=10
```

Then run:
```bash
npx tsx scripts/generate-address-list-smoke.ts
```

## Step 4: Manual Testing with curl

```bash
curl -X POST http://localhost:3000/api/campaigns/generate-address-list \
  -H "Content-Type: application/json" \
  -d '{
    "campaign_id": "your-campaign-uuid-here",
    "starting_address": "123 Main St, San Francisco, CA",
    "count": 10
  }'
```

Expected response:
```json
{
  "inserted_count": 10,
  "preview": [
    {
      "id": "uuid",
      "formatted": "123 Main St",
      "postal_code": "94102",
      "source": "closest_home",
      "source_id": "overture-gers-id"
    },
    ...
  ]
}
```

## Step 5: Verify Results in Supabase

### Check inserted addresses:
```sql
SELECT 
  id,
  formatted,
  postal_code,
  source,
  source_id,
  geom,
  seq,
  created_at
FROM campaign_addresses
WHERE campaign_id = 'your-campaign-uuid-here'
ORDER BY seq
LIMIT 20;
```

### Verify geometry format:
```sql
SELECT 
  formatted,
  ST_AsText(geom) as geometry_wkt,
  ST_X(geom) as longitude,
  ST_Y(geom) as latitude
FROM campaign_addresses
WHERE campaign_id = 'your-campaign-uuid-here'
LIMIT 5;
```

### Check campaign total_flyers was updated:
```sql
SELECT id, name, total_flyers
FROM campaigns
WHERE id = 'your-campaign-uuid-here';
```

## Step 6: Test Deduplication

Run the same request twice - the second time should not create duplicates:

```bash
# First run
npx tsx scripts/generate-address-list-smoke.ts

# Second run (should show same count, no new inserts)
npx tsx scripts/generate-address-list-smoke.ts
```

Check in Supabase:
```sql
-- Should show same count both times
SELECT COUNT(*) FROM campaign_addresses 
WHERE campaign_id = 'your-campaign-uuid-here';
```

## Troubleshooting

### Error: "Failed to geocode address"
- Check `NEXT_PUBLIC_MAPBOX_TOKEN` is set correctly
- Verify the address format is valid
- Check Mapbox API quota/limits

### Error: "MotherDuck connection failed"
- Check `MOTHERDUCK_TOKEN` is set (or it will use local DuckDB)
- Verify token is valid
- If using local DuckDB, ensure DuckDB is installed

### Error: "Campaign not found"
- Verify the `CAMPAIGN_ID` exists in your database
- Check the UUID format is correct

### Error: "No addresses found"
- The starting address might be in an area without Overture data
- Try a different address in a major city
- Check Overture data coverage for that location

### Error: "Failed to insert addresses"
- Check the migration ran successfully
- Verify `source_id` column exists: `\d campaign_addresses` in psql
- Check for constraint violations in Supabase logs

## Expected Behavior

✅ **Success Case:**
- Geocoding returns lat/lng
- Overture query returns addresses
- Addresses inserted with WKT geometry format
- `total_flyers` updated on campaign
- Preview shows first 10 addresses

❌ **Failure Cases:**
- Invalid address → 400 error with geocoding message
- No Overture data → Returns 200 with `inserted_count: 0`
- Database error → 500 error (check logs)

## Performance Notes

- First query may be slow (DuckDB/MotherDuck initialization)
- Subsequent queries should be faster
- Large `count` values (>100) may take longer
- Overture query uses ~5km radius bounding box for performance
