/**
 * Add Roads to existing MotherDuck database
 * 
 * This script adds ONLY the roads table to an existing overture_na database.
 * Use this if you already have buildings and addresses loaded.
 * 
 * Run with: npx tsx scripts/add-roads-to-motherduck.ts
 * 
 * Estimated time: 30-60 minutes
 * Estimated size: ~10-20GB additional
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import duckdb from 'duckdb';

async function main() {
  console.log('=== MotherDuck Roads Loader ===\n');

  const token = process.env.MOTHERDUCK_TOKEN;
  if (!token) {
    console.error('ERROR: MOTHERDUCK_TOKEN not set');
    process.exit(1);
  }
  console.log('✓ MOTHERDUCK_TOKEN found\n');

  console.log('Connecting to MotherDuck...');
  const db = new duckdb.Database('md:');
  const conn = db.connect();

  const runQuery = (sql: string): Promise<any[]> => {
    return new Promise((resolve, reject) => {
      conn.all(sql, (err: any, result: any) => {
        if (err) reject(err);
        else resolve(result || []);
      });
    });
  };

  const runExec = (sql: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      conn.exec(sql, (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });
  };

  try {
    // Load required extensions
    console.log('Loading extensions...');
    await runExec('INSTALL spatial; LOAD spatial;');
    await runExec('INSTALL httpfs; LOAD httpfs;');
    console.log('✓ Extensions loaded\n');

    const DB_NAME = 'overture_na';
    
    // Use existing database
    await runExec(`USE ${DB_NAME};`);
    console.log(`✓ Using existing ${DB_NAME} database\n`);

    // Check if roads table already exists
    try {
      const existing = await runQuery(`SELECT COUNT(*) as cnt FROM ${DB_NAME}.roads LIMIT 1;`);
      console.log(`Roads table already exists with ${existing[0]?.cnt} rows.`);
      console.log('Dropping and recreating...\n');
      await runExec(`DROP TABLE IF EXISTS ${DB_NAME}.roads;`);
    } catch (e) {
      console.log('Roads table does not exist yet, creating fresh.\n');
    }

    // Configuration
    const OVERTURE_RELEASE = '2025-12-17.0';
    const OVERTURE_S3_REGION = 'us-west-2';
    const ROADS_BUCKET = `s3://overturemaps-us-west-2/release/${OVERTURE_RELEASE}/theme=transportation/type=segment/*`;

    // North America bounding box
    const NA_BBOX = {
      west: -141.0,
      east: -52.0,
      south: 24.0,
      north: 72.0,
    };

    // Set S3 region for Overture (public bucket, no auth needed)
    await runExec(`SET s3_region='${OVERTURE_S3_REGION}';`);
    await runExec(`SET s3_access_key_id='';`);
    await runExec(`SET s3_secret_access_key='';`);

    console.log('--- Loading US + Canada Roads ---');
    console.log('This may take 30-60 minutes...');
    console.log(`Source: ${ROADS_BUCKET}`);
    console.log(`Filter: North America bbox, residential/secondary/tertiary/primary classes only\n`);

    const startRoads = Date.now();

    await runExec(`
      CREATE TABLE roads AS
      SELECT 
        id as gers_id,
        ST_AsGeoJSON(geometry) as geometry_json,
        bbox.xmin as bbox_west,
        bbox.ymin as bbox_south,
        bbox.xmax as bbox_east,
        bbox.ymax as bbox_north,
        class,
        COALESCE(names.primary, '') as name
      FROM read_parquet('${ROADS_BUCKET}', hive_partitioning=1)
      WHERE 
        bbox.xmin BETWEEN ${NA_BBOX.west} AND ${NA_BBOX.east}
        AND bbox.ymin BETWEEN ${NA_BBOX.south} AND ${NA_BBOX.north}
        AND class IN ('residential', 'secondary', 'tertiary', 'primary')
        AND geometry IS NOT NULL;
    `);

    const roadTime = Math.round((Date.now() - startRoads) / 1000);
    console.log(`✓ Roads loaded in ${roadTime}s`);

    // Count roads
    const roadCount = await runQuery('SELECT COUNT(*) as cnt FROM roads;');
    console.log(`✓ Total roads: ${roadCount[0]?.cnt?.toLocaleString()}\n`);

    // Create spatial index
    console.log('Creating roads bbox index...');
    await runExec('CREATE INDEX IF NOT EXISTS idx_roads_bbox ON roads(bbox_west, bbox_south, bbox_east, bbox_north);');
    console.log('✓ Index created\n');

    // Final summary
    console.log('\n=== Roads Added Successfully ===');
    console.log(`Database: ${DB_NAME}`);
    console.log('New table: roads (US + Canada, residential/secondary/tertiary/primary)');
    console.log('\nStreet name lock and house orientation will now work on Vercel!');

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  } finally {
    conn.close?.();
    db.close?.();
  }
}

main().catch(console.error);
