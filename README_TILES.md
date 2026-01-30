# PMTiles Setup Guide

This guide explains how to convert exported GeoJSON building data into PMTiles format and upload it to Supabase Storage for high-performance map rendering.

## Overview

PMTiles is a single-file format for vector tiles that enables fast, efficient map rendering without API calls. Buildings are "baked" into the tileset once, then served directly from Supabase Storage.

## Prerequisites

1. **tippecanoe** - Tool for converting GeoJSON to PMTiles
2. **Supabase Storage bucket** - Named `map-tiles` (must be created in Supabase Dashboard)
3. **Exported GeoJSON file** - From `scripts/export-overture-tiles.ts`

## Step 1: Install tippecanoe

### macOS
```bash
brew install tippecanoe
```

### Linux (Ubuntu/Debian)
```bash
sudo apt-get install tippecanoe
```

### Linux (Fedora/RHEL)
```bash
sudo dnf install tippecanoe
```

### Build from Source
If your package manager doesn't have tippecanoe:
```bash
git clone https://github.com/felt/tippecanoe.git
cd tippecanoe
make -j
sudo make install
```

## Step 2: Export Buildings to GeoJSON

Run the export script to generate `data/buildings.geojson`:

```bash
# Export for a specific campaign
npx tsx scripts/export-overture-tiles.ts [campaignId]

# Example
npx tsx scripts/export-overture-tiles.ts abc123-def456
```

The script will:
- Query Overture buildings via MotherDuck
- Join with campaign addresses from Supabase
- Export to `data/buildings.geojson`

**Note:** This may take 1-2 minutes for large campaigns or cities.

## Step 3: Convert GeoJSON to PMTiles

Use tippecanoe to convert the GeoJSON file:

```bash
tippecanoe -o buildings.pmtiles -zg --projection=EPSG:4326 -L buildings:data/buildings.geojson data/buildings.geojson
```

**Note:** The `-L buildings:` flag names the layer "buildings" in the PMTiles file. Without it, tippecanoe uses the filename or "0" as the layer name.

### Command Options Explained

- `-o buildings.pmtiles` - Output filename
- `-zg` - Automatically calculate zoom levels based on data density
- `--projection=EPSG:4326` - Use WGS84 coordinate system (standard for web maps)

### Advanced Options

For very large datasets, you may want to optimize:

```bash
tippecanoe \
  -o buildings.pmtiles \
  -zg \
  --projection=EPSG:4326 \
  --drop-densest-as-needed \
  --extend-zooms-if-still-dropping \
  --maximum-zoom=16 \
  --minimum-zoom=10 \
  data/buildings.geojson
```

**Options:**
- `--drop-densest-as-needed` - Remove dense features at low zoom levels
- `--extend-zooms-if-still-dropping` - Add more zoom levels if needed
- `--maximum-zoom=16` - Limit maximum zoom (reduces file size)
- `--minimum-zoom=10` - Start showing buildings at zoom 10

## Step 4: Upload to Supabase Storage

### Option A: Using Supabase Dashboard

1. Go to your Supabase project dashboard
2. Navigate to **Storage** → **Buckets**
3. Create a new bucket named `map-tiles` (if it doesn't exist)
   - Set it as **Public** (for public read access)
4. Click **Upload file** and select `buildings.pmtiles`
5. Copy the public URL (format below)

### Option B: Using Supabase CLI

```bash
# Install Supabase CLI if needed
npm install -g supabase

# Login
supabase login

# Upload file
supabase storage upload buildings.pmtiles map-tiles/buildings.pmtiles --project-ref [your-project-ref]
```

### Option C: Using Node.js Script

Create a script `scripts/upload-pmtiles.ts`:

```typescript
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const filePath = 'buildings.pmtiles';
const bucketName = 'map-tiles';
const fileName = 'buildings.pmtiles';

async function uploadPmtiles() {
  const file = fs.readFileSync(filePath);
  
  const { data, error } = await supabase.storage
    .from(bucketName)
    .upload(fileName, file, {
      contentType: 'application/x-protobuf',
      upsert: true, // Overwrite if exists
    });

  if (error) {
    console.error('Upload failed:', error);
    return;
  }

  const { data: { publicUrl } } = supabase.storage
    .from(bucketName)
    .getPublicUrl(fileName);

  console.log('✅ Upload successful!');
  console.log('Public URL:', publicUrl);
}

uploadPmtiles();
```

Run it:
```bash
npx tsx scripts/upload-pmtiles.ts
```

## Public URL Format

After uploading, your PMTiles file will be accessible at:

```
https://[project-id].supabase.co/storage/v1/object/public/map-tiles/buildings.pmtiles
```

Replace `[project-id]` with your Supabase project ID (found in project settings).

**Example:**
```
https://kfnsnwqylsdsbgnwgxva.supabase.co/storage/v1/object/public/map-tiles/buildings.pmtiles
```

## Step 5: Create Storage Bucket (if needed)

If the `map-tiles` bucket doesn't exist, create it via SQL:

```sql
-- Create the bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('map-tiles', 'map-tiles', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access
CREATE POLICY "Public map tiles access"
ON storage.objects FOR SELECT
USING (bucket_id = 'map-tiles');
```

Or use the Supabase Dashboard:
1. Go to **Storage** → **Buckets**
2. Click **New bucket**
3. Name: `map-tiles`
4. Check **Public bucket**
5. Click **Create bucket**

## File Size Considerations

- **Small cities (< 100k buildings):** ~10-50 MB
- **Medium cities (100k-500k buildings):** ~50-200 MB
- **Large cities (> 500k buildings):** ~200-500 MB+

**Optimization Tips:**
- Use `--maximum-zoom` to limit detail at high zoom levels
- Use `--drop-densest-as-still-needed` for dense urban areas
- Consider splitting into regional tilesets for very large areas
- Supabase Storage free tier: 1 GB, paid tiers scale up

## Updating Tiles

When building data changes:

1. Re-run the export script: `npx tsx scripts/export-overture-tiles.ts [campaignId]`
2. Re-convert to PMTiles: `tippecanoe -o buildings.pmtiles -zg --projection=EPSG:4326 data/buildings.geojson`
3. Re-upload to Supabase Storage (use `upsert: true` in upload script)

**Automation:** Consider setting up a GitHub Action or cron job to run exports weekly/monthly.

## Troubleshooting

### "tippecanoe: command not found"
- Install tippecanoe using the instructions above
- Ensure it's in your PATH

### "File too large" error
- Use optimization options (see Advanced Options above)
- Consider splitting into multiple tilesets by region

### "Bucket not found" error
- Create the `map-tiles` bucket in Supabase Dashboard
- Ensure bucket is set to **Public**

### "Access denied" error
- Check bucket permissions (should be public)
- Verify storage policies are set correctly

## Next Steps

After uploading PMTiles:
1. Update `BuildingLayers.tsx` to use PMTiles (see implementation plan)
2. Test the map to ensure buildings render correctly
3. Verify feature state coloring works with active campaigns
