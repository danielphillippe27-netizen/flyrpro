import { createClient } from '@supabase/supabase-js';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';

// Load .env.local first, then .env
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });
dotenv.config();

// --- CONFIGURATION ---
const BATCH_SIZE = 500;

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
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!, 
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false }, db: { schema: 'public' } }
);

const s3 = new S3Client({ 
  region: process.env.AWS_REGION || 'us-east-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
  }
});

// For deletes only - uses direct connection
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
  connectionTimeoutMillis: 30000,
  query_timeout: 120000,
  statement_timeout: 120000
});

// Convert Polygon to MultiPolygon
function convertToMultiPolygon(geometry: any): any {
  if (!geometry) return geometry;
  if (geometry.type === 'Polygon') {
    return { type: 'MultiPolygon', coordinates: [geometry.coordinates] };
  }
  return geometry;
}

async function loadGoldHttp(type: 'address' | 'building') {
  const config = SOURCE_CONFIG[type];
  console.log(`\n🔵 STARTING HTTP LOAD: ${type.toUpperCase()} (${config.sourceId})`);

  try {
    // 1. Download
    console.log(`⬇️  Downloading s3://${S3_BUCKET}/${config.s3Key}...`);
    const s3Res = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: config.s3Key }));
    const raw = await s3Res.Body?.transformToString();
    const geojson = JSON.parse(raw || '{}');
    const features = geojson.features || [];
    console.log(`📦 Parsed ${features.length.toLocaleString()} features.`);

    // 2. Delete skipped - data cleared manually via SQL Editor
    console.log(`⏭️  Delete skipped (cleared manually in SQL Editor)`);

    // 3. Batch Insert via HTTP
    console.log(`🚀 Inserting ${features.length} rows via HTTP (batch size: ${BATCH_SIZE})...`);
    
    let inserted = 0;
    let skipped = 0;
    const totalBatches = Math.ceil(features.length / BATCH_SIZE);

    for (let i = 0; i < features.length; i += BATCH_SIZE) {
      const batch = features.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      
      const rows = batch.map((f: any, idx: number) => {
        const p = f.properties;
        const g = type === 'building' ? convertToMultiPolygon(f.geometry) : f.geometry;

        if (type === 'address') {
          const streetName = p.street_name;
          const streetNumber = p.street_number;
          const city = p.city || 'Toronto';
          const unit = p.unit;
          
          if (!streetName || streetName.trim() === '') {
            return null;
          }
          
          const cleanStreetNumber = streetNumber ? String(streetNumber).replace(/None$/i, '') : null;
          
          return {
            source_id: config.sourceId,
            street_number: cleanStreetNumber,
            street_name: String(streetName).trim(),
            unit: unit || null,
            city: String(city),
            geom: g
          };
        } else {
          const externalId = p.source_id ? String(p.source_id) : `${config.sourceId}_${i + idx}`;
          const areaSqm = p.area_sqm || p.ShapeSTArea || 0;
          
          return {
            source_id: config.sourceId,
            external_id: externalId,
            area_sqm: Number(areaSqm) || 0,
            geom: g
          };
        }
      }).filter((row: any) => row !== null);

      skipped += (batch.length - rows.length);

      if (rows.length === 0) continue;

      const { error } = await supabase.from(config.table).insert(rows);
      
      if (error) {
        console.error(`\n❌ Error in batch ${batchNum}/${totalBatches}:`, error.message);
      } else {
        process.stdout.write('.');
        if (batchNum % 20 === 0) {
          process.stdout.write(` ${Math.round((batchNum / totalBatches) * 100)}%`);
        }
      }
      inserted += rows.length;
    }

    console.log(`\n✅ DONE: Processed ${inserted.toLocaleString()} rows (${skipped.toLocaleString()} skipped).`);

  } catch (err) {
    console.error(`\n❌ CRITICAL FAILURE:`, err);
    process.exit(1);
  }
}

(async () => {
  const startTime = Date.now();
  
  console.log('🏈 QUARTERBACK GOLD LOADER');
  console.log('==========================');
  console.log(`Supabase URL: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);
  console.log(`S3 Bucket: ${S3_BUCKET}`);
  
  await loadGoldHttp('building');
  await loadGoldHttp('address');
  
  await pool.end();
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n🎉 ALL DONE! Total time: ${duration}s`);
  
  process.exit(0);
})();
