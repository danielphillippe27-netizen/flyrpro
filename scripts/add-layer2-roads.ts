/**
 * Add Layer 2 Roads to existing MotherDuck database
 * 
 * This script adds the `layer` column and loads Layer 2 roads (service, private, etc.)
 * to the existing overture_na.roads table for opt-in expansion.
 * 
 * Run with: npx tsx scripts/add-layer2-roads.ts
 * 
 * Prerequisites:
 * - MOTHERDUCK_TOKEN environment variable set
 * - Existing overture_na database with roads table (run load-overture-to-motherduck.ts first)
 * 
 * Layer definitions:
 * - Layer 1 (existing): residential, tertiary, secondary, primary - for house snapping
 * - Layer 2 (new): service, living_street, unclassified - for GPS replay, condo access
 * 
 * Estimated time: 30-60 minutes (one-time)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import duckdb from 'duckdb';

async function main() {
  console.log('=== Layer 2 Roads Loader ===\n');

  const token = process.env.MOTHERDUCK_TOKEN;
  if (!token) {
    console.error('ERROR: MOTHERDUCK_TOKEN not set');
    process.exit(1);
  }
  console.log('✓ MOTHERDUCK_TOKEN found\n');

  console.log('Connecting to MotherDuck...');
  const db = new duckdb.Database('md:');
  const conn = db.connect();

  // Helper to run queries
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
    console.log(`✓ Using database: ${DB_NAME}\n`);

    // Check if roads table exists
    const tables = await runQuery(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' AND table_name = 'roads';`);
    if (tables.length === 0) {
      console.error('ERROR: roads table not found. Run load-overture-to-motherduck.ts first.');
      process.exit(1);
    }
    console.log('✓ Roads table found\n');

    // Check current row count
    const beforeCount = await runQuery('SELECT COUNT(*) as cnt FROM roads;');
    console.log(`Current roads count: ${beforeCount[0]?.cnt?.toLocaleString()}\n`);

    // Step 1: Check if layer column exists, add if not
    console.log('--- Step 1: Adding layer column ---');
    const columns = await runQuery(`SELECT column_name FROM information_schema.columns WHERE table_name = 'roads' AND column_name = 'layer';`);
    
    if (columns.length === 0) {
      console.log('Adding layer column to roads table...');
      await runExec(`ALTER TABLE roads ADD COLUMN layer INTEGER DEFAULT 1;`);
      console.log('✓ Layer column added (existing rows set to layer=1)\n');
    } else {
      console.log('✓ Layer column already exists\n');
    }

    // Step 2: Load Layer 2 roads from Overture
    console.log('--- Step 2: Loading Layer 2 Roads ---');
    console.log('Classes: service, living_street, unclassified');
    console.log('This may take 30-60 minutes...\n');

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

    // Set S3 region for Overture
    await runExec(`SET s3_region='${OVERTURE_S3_REGION}';`);

    const startRoads = Date.now();

    // Insert Layer 2 roads
    // Layer 2 classes: service (condo roads, parking), living_street (shared spaces), unclassified (new subdivisions)
    await runExec(`
      INSERT INTO roads (gers_id, geometry_json, bbox_west, bbox_south, bbox_east, bbox_north, class, name, layer)
      SELECT 
        id as gers_id,
        ST_AsGeoJSON(geometry) as geometry_json,
        bbox.xmin as bbox_west,
        bbox.ymin as bbox_south,
        bbox.xmax as bbox_east,
        bbox.ymax as bbox_north,
        class,
        COALESCE(names.primary, '') as name,
        2 as layer
      FROM read_parquet('${ROADS_BUCKET}', hive_partitioning=1)
      WHERE 
        bbox.xmin BETWEEN ${NA_BBOX.west} AND ${NA_BBOX.east}
        AND bbox.ymin BETWEEN ${NA_BBOX.south} AND ${NA_BBOX.north}
        AND class IN ('service', 'living_street', 'unclassified')
        AND geometry IS NOT NULL;
    `);

    const roadTime = Math.round((Date.now() - startRoads) / 1000);
    console.log(`✓ Layer 2 roads loaded in ${roadTime}s\n`);

    // Step 3: Create index on layer column
    console.log('--- Step 3: Creating layer index ---');
    await runExec('CREATE INDEX IF NOT EXISTS idx_roads_layer ON roads(layer);');
    console.log('✓ Layer index created\n');

    // Final summary
    const afterCount = await runQuery('SELECT COUNT(*) as cnt FROM roads;');
    const layer1Count = await runQuery('SELECT COUNT(*) as cnt FROM roads WHERE layer = 1;');
    const layer2Count = await runQuery('SELECT COUNT(*) as cnt FROM roads WHERE layer = 2;');

    console.log('\n=== Layer 2 Roads Setup Complete ===');
    console.log(`Total roads: ${afterCount[0]?.cnt?.toLocaleString()}`);
    console.log(`  Layer 1 (core): ${layer1Count[0]?.cnt?.toLocaleString()}`);
    console.log(`  Layer 2 (routing): ${layer2Count[0]?.cnt?.toLocaleString()}`);
    console.log('\nLayer 1: residential, tertiary, secondary, primary');
    console.log('Layer 2: service, living_street, unclassified');
    console.log('\nUse getRoadsInPolygon({ includeLayers: [1, 2] }) for expanded coverage.');

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  } finally {
    conn.close?.();
    db.close?.();
  }
}

main().catch(console.error);
