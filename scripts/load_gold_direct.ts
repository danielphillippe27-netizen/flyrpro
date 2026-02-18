import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import path from 'path';
import pg from 'pg';
import dotenv from 'dotenv';

// Load .env.local first (where AWS creds / DATABASE_URL typically live), then .env
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });
dotenv.config();

// --- CONFIGURATION ---
const CONCURRENCY = 10; // Number of parallel connections
const BATCH_SIZE = 1000; // Rows per insert
const S3_BUCKET = process.env.AWS_BUCKET_NAME || 'flyr-pro-addresses-2025';

// Initialize Clients
const s3 = new S3Client({ 
  region: process.env.AWS_REGION || 'us-east-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
  }
});

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: CONCURRENCY + 5 // Ensure pool is large enough
});

async function loadGoldParallel(type: 'address' | 'building') {
  const table = type === 'address' ? 'ref_addresses_gold' : 'ref_buildings_gold';
  const s3Key = type === 'address' 
    ? 'gold-standard/canada/ontario/toronto/addresses.geojson'
    : 'gold-standard/canada/ontario/toronto/buildings.geojson';
  const sourceId = type === 'address' ? 'toronto_addresses' : 'toronto_buildings';

  console.log(`\n🔵 STARTING PARALLEL LOAD: ${type.toUpperCase()}`);

  try {
    // 1. Download & Parse
    console.log(`⬇️  Downloading ${s3Key}...`);
    const s3Res = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: s3Key }));
    const raw = await s3Res.Body?.transformToString();
    const geojson = JSON.parse(raw || '{}');
    const features = geojson.features;
    console.log(`📦 Loaded ${features.length.toLocaleString()} features.`);

    // 2. Clear Old Data
    const client = await pool.connect();
    console.log(`🧹 Clearing old data...`);
    await client.query(`DELETE FROM ${table} WHERE source_id = $1`, [sourceId]);
    client.release();

    // 3. Prepare Batches
    const batches = [];
    for (let i = 0; i < features.length; i += BATCH_SIZE) {
      batches.push(features.slice(i, i + BATCH_SIZE));
    }
    console.log(`⚡ Processing ${batches.length} batches with ${CONCURRENCY} workers...`);

    // 4. Parallel Worker Function
    let completedBatches = 0;
    
    const processBatch = async (batch: any[]) => {
      const client = await pool.connect();
      try {
        // Construct Bulk Insert Query
        const valuePlaceholders: string[] = [];
        const values: any[] = [];
        let paramIdx = 1;

        for (const f of batch) {
          const p = f.properties;
          const g = JSON.stringify(f.geometry);
          
          if (type === 'address') {
            // Skip records with missing required fields
            const streetName = p.street_name || p.LINEAR_NAME_FULL || p.ST_NAME || p.LF_NAME || p.ROAD_NAME;
            const streetNumber = p.street_number || p.street_num || p.ADDRESS_NUMBER || p.CIVIC_NUM || p.HI_NUM || p.HI_NUM_NO;
            const city = p.city || p.MUNICIPALITY || p.TOWN || 'Toronto';
            const province = p.province || p.PROVINCE || 'ON';
            const country = p.country || p.COUNTRY || 'CA';
            
            if (!streetName || !streetNumber || !city) {
              continue; // Skip this record
            }
            
            valuePlaceholders.push(`($${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3}, $${paramIdx+4}, $${paramIdx+5}, $${paramIdx+6}, ST_SetSRID(ST_GeomFromGeoJSON($${paramIdx+7}), 4326))`);
            values.push(sourceId, streetNumber, streetName, p.unit || p.UNIT || p.SUITE || null, city, province, country, g);
            paramIdx += 8;
          } else {
            valuePlaceholders.push(`($${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON($${paramIdx+3})), 4326))`);
            values.push(sourceId, p.GlobalID || p.OBJECTID || p.id, p.ShapeSTArea || p.area || 0, g);
            paramIdx += 4;
          }
        }

        // Skip if no valid records in this batch
        if (valuePlaceholders.length === 0) {
          completedBatches++;
          return;
        }
        
        const cols = type === 'address' 
          ? '(source_id, street_number, street_name, unit, city, province, country, geom)'
          : '(source_id, external_id, area_sqm, geom)';
        
        const query = `INSERT INTO ${table} ${cols} VALUES ${valuePlaceholders.join(',')}`;
        
        await client.query(query, values);
        
        completedBatches++;
        if (completedBatches % 10 === 0) {
           process.stdout.write(`\r✅  Progress: ${Math.round((completedBatches / batches.length) * 100)}%`);
        }
      } finally {
        client.release();
      }
    };

    // 5. Run with Concurrency Limit
    // Simple implementation of a promise pool
    const queue = [...batches];
    const workers = Array(CONCURRENCY).fill(null).map(async () => {
      while (queue.length > 0) {
        const batch = queue.shift();
        if (batch) await processBatch(batch);
      }
    });

    await Promise.all(workers);
    console.log(`\n🎉 DONE! Loaded ${features.length.toLocaleString()} rows into ${table}.`);

  } catch (err) {
    console.error(`\n❌ ERROR:`, err);
    process.exit(1);
  }
}

(async () => {
  await loadGoldParallel('building');
  await loadGoldParallel('address');
  await pool.end();
})();
