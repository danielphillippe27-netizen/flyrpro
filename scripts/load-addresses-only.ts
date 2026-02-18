// scripts/load-addresses-only.ts
import { createClient } from '@supabase/supabase-js';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import * as dotenv from 'dotenv';
import path from 'path';

// Load .env.local first
const result = dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });
if (result.error) {
  dotenv.config();
}

const BATCH_SIZE = 1000;

const S3_BUCKET = process.env.AWS_BUCKET_NAME || 'flyr-pro-addresses-2025';

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase Credentials');
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { 
    auth: { persistSession: false }, 
    db: { schema: 'public' } 
  }
);

const s3 = new S3Client({ 
  region: process.env.AWS_REGION || 'us-east-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
  }
});

async function loadAddresses() {
  const sourceId = 'toronto_addresses';
  const table = 'ref_addresses_gold';
  const s3Key = 'gold-standard/canada/ontario/toronto/addresses.geojson';
  
  console.log(`\n🔵 STARTING LOAD: ADDRESSES (${sourceId})`);

  try {
    // Download from S3
    console.log(`⬇️  Downloading s3://${S3_BUCKET}/${s3Key}...`);
    const s3Res = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: s3Key }));
    const raw = await s3Res.Body?.transformToString();
    
    if (!raw) throw new Error('Empty body from S3');
    
    const geojson = JSON.parse(raw);
    const features = geojson.features || [];
    console.log(`📦 Parsed ${features.length.toLocaleString()} features.`);

    // Batch Process
    console.log(`🚀 Processing batches of ${BATCH_SIZE}...`);
    let successCount = 0;
    let errorCount = 0;
    const totalBatches = Math.ceil(features.length / BATCH_SIZE);

    for (let i = 0; i < features.length; i += BATCH_SIZE) {
      const batch = features.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      
      const rows = batch.map((f: any) => {
        const p = f.properties;
        const g = f.geometry;
        
        // Use actual field names from Toronto data
        const streetNumber = p.ADDRESS_NUMBER ?? p.LO_NUM ?? null;
        const streetName = p.LINEAR_NAME_FULL ?? p.ADDRESS_FULL ?? null;
        const city = p.MUNICIPALITY_NAME ?? p.city ?? 'Toronto';
        const unit = p.LO_NUM_SUF !== 'None' ? p.LO_NUM_SUF : null;
        
        // Skip if no street name
        if (!streetName || String(streetName).trim() === '' || streetName === 'None') {
          return null;
        }
        
        return {
          source_id: sourceId,
          street_number: streetNumber ? String(streetNumber).replace(/None$/i, '').trim() : null,
          street_name: String(streetName).trim(),
          unit: unit,
          city: String(city).trim(),
          geom: g
        };
      }).filter((r: any) => r !== null);

      if (rows.length === 0) continue;

      const { error } = await supabase.from(table).insert(rows);
      
      if (error) {
        console.error(`❌ Batch ${batchNum} Failed:`, error.message);
        errorCount += rows.length;
      } else {
        successCount += rows.length;
        if (batchNum % 10 === 0 || batchNum === totalBatches) {
          console.log(`✅ Batch ${batchNum}/${totalBatches} saved. (${successCount.toLocaleString()} total)`);
        }
      }
    }

    console.log(`\n🏁 ADDRESSES FINISHED.`);
    console.log(`   Success: ${successCount.toLocaleString()}`);
    console.log(`   Failed:  ${errorCount.toLocaleString()}`);

  } catch (err) {
    console.error(`\n❌ CRITICAL FAILURE:`, err);
    throw err;
  }
}

(async () => {
  console.log('🏈 LOADING TORONTO ADDRESSES ONLY');
  console.log('==================================================');
  
  try {
    await loadAddresses();
    console.log('\n🎉 DONE');
    process.exit(0);
  } catch (e) {
    process.exit(1);
  }
})();
