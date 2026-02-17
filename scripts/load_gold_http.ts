import { createClient } from '@supabase/supabase-js';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import path from 'path';

// Load .env.local first
const result = dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });
if (result.error) {
  dotenv.config();
}

// --- CONFIGURATION ---
// HTTP Batch size (Lower is safer for timeouts)
const BATCH_SIZE = 100;

// Toronto data configuration
const SOURCE_CONFIG = {
  address: {
    s3Key: 'gold-standard/canada/ontario/toronto/addresses.geojson',
    sourceId: 'toronto_addresses',
    table: 'ref_addresses_gold'
  },
  building: {
    s3Key: 'gold-standard/canada/ontario/toronto/buildings.geojson',
    sourceId: 'toronto_buildings',
    table: 'ref_buildings_gold'
  }
};

// Initialize Supabase Client (uses HTTPS API - bypasses IPv6 issues)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing required environment variables:');
  if (!supabaseUrl) console.error('   - NEXT_PUBLIC_SUPABASE_URL');
  if (!supabaseKey) console.error('   - SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
});

// Initialize S3 Client
const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
  }
});

const S3_BUCKET = process.env.AWS_BUCKET_NAME || 'flyr-pro-addresses-2025';

async function loadGoldHttp(type: 'address' | 'building') {
  const config = SOURCE_CONFIG[type];
  console.log(`\n🔵 STARTING HTTP LOAD: ${type.toUpperCase()} (${config.sourceId})`);

  try {
    // 1. Download from S3
    console.log(`⬇️  Downloading s3://${S3_BUCKET}/${config.s3Key}...`);
    const s3Res = await s3.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: config.s3Key
    }));
    const raw = await s3Res.Body?.transformToString();
    const geojson = JSON.parse(raw || '{}');
    const features = geojson.features || [];
    console.log(`📦 Parsed ${features.length.toLocaleString()} features.`);

    // 2. Delete old data
    console.log(`🧹 Deleting old records for source_id='${config.sourceId}'...`);
    const { error: delError } = await supabase
      .from(config.table)
      .delete()
      .eq('source_id', config.sourceId);

    if (delError) {
      console.error('❌ Delete error:', delError);
      throw delError;
    }
    console.log(`✅ Cleared old data`);

    // 3. Batch insert
    console.log(`🚀 Inserting ${features.length.toLocaleString()} rows via HTTPS API...`);
    console.log(`   (Batch size: ${BATCH_SIZE}, Total batches: ~${Math.ceil(features.length / BATCH_SIZE)})`);

    let inserted = 0;
    let errors = 0;
    const totalBatches = Math.ceil(features.length / BATCH_SIZE);

    for (let i = 0; i < features.length; i += BATCH_SIZE) {
      const batch = features.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;

      // Transform features to database rows
      const rows = batch.map((f: any) => {
        const p = f.properties;
        const g = f.geometry;

        if (type === 'address') {
          // Address fields with multiple possible source keys
          const streetName = p.street_name || p.ST_NAME || p.LF_NAME || p.ROAD_NAME;
          const streetNumber = p.street_num || p.CIVIC_NUM || p.HI_NUM || p.HI_NUM_NO || p.street_number;
          const city = p.city || p.MUNICIPALITY || p.TOWN || 'Toronto';
          const unit = p.unit || p.UNIT || p.SUITE || null;

          return {
            source_id: config.sourceId,
            street_number: streetNumber?.toString() || null,
            street_name: streetName,
            unit: unit,
            city: city,
            geom: g
          };
        } else {
          // Building fields
          return {
            source_id: config.sourceId,
            external_id: p.GlobalID || p.OBJECTID || p.id || `bld_${i}`,
            area_sqm: p.ShapeSTArea || p.area || p.SHAPE_Area || 0,
            geom: g
          };
        }
      }).filter((row: any) => {
        // Filter out rows with missing critical fields
        if (type === 'address') {
          return row.street_name && row.street_number;
        }
        return true;
      });

      if (rows.length === 0) continue;

      // Insert batch
      const { error } = await supabase.from(config.table).insert(rows);

      if (error) {
        console.error(`\n❌ Error in batch ${batchNum}/${totalBatches}:`, error.message);
        errors += rows.length;
        // Continue with next batch instead of crashing
      } else {
        inserted += rows.length;
        if (batchNum % 10 === 0 || batchNum === totalBatches) {
          process.stdout.write(`\r✅ Progress: ${batchNum}/${totalBatches} batches (${Math.round((batchNum / totalBatches) * 100)}%) | Inserted: ${inserted.toLocaleString()}`);
        } else {
          process.stdout.write('.');
        }
      }

      // Small delay to avoid rate limiting
      if (batchNum % 50 === 0) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    console.log(`\n\n🎉 DONE: ${type.toUpperCase()}`);
    console.log(`   Inserted: ${inserted.toLocaleString()} rows`);
    if (errors > 0) console.log(`   Errors: ${errors.toLocaleString()} rows`);

  } catch (err) {
    console.error(`\n❌ CRITICAL FAILURE for ${type}:`, err);
    process.exit(1);
  }
}

// Run it
(async () => {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  TORONTO GOLD DATA LOADER (HTTP API Mode)');
  console.log('  Uses Supabase REST API to bypass IPv6 connection issues');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Supabase URL: ${supabaseUrl}`);
  console.log(`S3 Bucket: ${S3_BUCKET}`);

  // Load buildings first (typically larger dataset)
  await loadGoldHttp('building');

  // Then load addresses
  await loadGoldHttp('address');

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  ALL DONE! Toronto Gold data loaded successfully.');
  console.log('═══════════════════════════════════════════════════════════════');
})();
