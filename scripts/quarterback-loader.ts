// scripts/quarterback-loader.ts
import { createClient } from '@supabase/supabase-js';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import * as dotenv from 'dotenv';

dotenv.config();

// --- CONFIGURATION ---
const BATCH_SIZE = 1000; // Efficient size for GitHub Actions runners

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

const S3_BUCKET = process.env.AWS_BUCKET_NAME || 'flyr-pro-addresses-2025';

// Initialize Clients
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

// Helper: Convert Polygon to MultiPolygon
function convertToMultiPolygon(geometry: any): any {
  if (!geometry) return geometry;
  if (geometry.type === 'Polygon') {
    return { type: 'MultiPolygon', coordinates: [geometry.coordinates] };
  }
  return geometry;
}

async function loadGoldHttp(type: 'address' | 'building') {
  const config = SOURCE_CONFIG[type];
  console.log(`\n🔵 STARTING LOAD: ${type.toUpperCase()} (${config.sourceId})`);

  try {
    // 1. Download from S3
    console.log(`⬇️  Downloading s3://${S3_BUCKET}/${config.s3Key}...`);
    const s3Res = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: config.s3Key }));
    const raw = await s3Res.Body?.transformToString();
    
    if (!raw) throw new Error('Empty body from S3');
    
    const geojson = JSON.parse(raw);
    const features = geojson.features || [];
    console.log(`📦 Parsed ${features.length.toLocaleString()} features.`);

    // 2. Batch Process
    console.log(`🚀 Processing batches of ${BATCH_SIZE}...`);
    let successCount = 0;
    let errorCount = 0;
    const totalBatches = Math.ceil(features.length / BATCH_SIZE);

    for (let i = 0; i < features.length; i += BATCH_SIZE) {
      const batch = features.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      
      // Transform Data
      const rows = batch.map((f: any, idx: number) => {
        const p = f.properties;
        const g = type === 'building' ? convertToMultiPolygon(f.geometry) : f.geometry;

        if (type === 'address') {
          const streetName = p.street_name;
          if (!streetName || String(streetName).trim() === '') return null;
          
          return {
            source_id: config.sourceId,
            street_number: p.street_number ? String(p.street_number).replace(/None$/i, '') : null,
            street_name: String(streetName).trim(),
            unit: p.unit || null,
            city: p.city ? String(p.city) : 'Toronto',
            geom: g
          };
        } else {
          // Buildings
          const externalId = p.source_id ? String(p.source_id) : `${config.sourceId}_${i + idx}`;
          return {
            source_id: config.sourceId,
            external_id: externalId,
            area_sqm: Number(p.area_sqm || p.ShapeSTArea || 0),
            geom: g
          };
        }
      }).filter((r: any) => r !== null);

      if (rows.length === 0) continue;

      // 3. Insert / Upsert
      let error;
      
      if (type === 'building') {
        // Buildings have unique external_id, so use Upsert for reliability
        const res = await supabase.from(config.table).upsert(rows, { onConflict: 'external_id' });
        error = res.error;
      } else {
        // Addresses don't have a clear unique ID in this logic, so standard Insert
        const res = await supabase.from(config.table).insert(rows);
        error = res.error;
      }
      
      if (error) {
        console.error(`❌ Batch ${batchNum} Failed:`, error.message);
        errorCount += rows.length;
      } else {
        successCount += rows.length;
        if (batchNum % 10 === 0) console.log(`✅ Batch ${batchNum}/${totalBatches} saved.`);
      }
    }

    console.log(`\n🏁 ${type.toUpperCase()} FINISHED.`);
    console.log(`   Success: ${successCount.toLocaleString()}`);
    console.log(`   Failed:  ${errorCount.toLocaleString()}`);

  } catch (err) {
    console.error(`\n❌ CRITICAL FAILURE in ${type}:`, err);
    throw err; // Throw to fail the GitHub Action
  }
}

(async () => {
  console.log('🏈 QUARTERBACK GOLD LOADER (GITHUB ACTIONS VERSION)');
  console.log('==================================================');
  
  try {
    await loadGoldHttp('building');
    await loadGoldHttp('address');
    console.log('\n🎉 ALL JOBS COMPLETE');
    process.exit(0);
  } catch (e) {
    process.exit(1);
  }
})();
