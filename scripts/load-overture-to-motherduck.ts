/**
 * Load Overture Maps + Private Address Data into MotherDuck
 * 
 * This script pre-loads data into MotherDuck for fast HTTP API querying:
 * - Buildings: From Overture Maps (US + Canada)
 * - Addresses: From your private 160M address database in S3
 * 
 * Run with: npx tsx scripts/load-overture-to-motherduck.ts
 * 
 * Prerequisites:
 * - MOTHERDUCK_TOKEN environment variable set
 * - AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY for private S3 bucket
 * - Sufficient MotherDuck storage quota
 * 
 * Data loaded:
 * - overture_na.buildings: US + Canada residential buildings (Overture)
 * - overture_na.addresses: 160M US addresses (your private S3 database)
 * 
 * Estimated size: ~10-20GB total
 * Estimated time: 45-75 minutes (one-time setup)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

// Import duckdb - handle both CommonJS and ES module formats
import duckdb from 'duckdb';

async function main() {
  console.log('=== MotherDuck Overture Data Loader ===\n');

  const token = process.env.MOTHERDUCK_TOKEN;
  if (!token) {
    console.error('ERROR: MOTHERDUCK_TOKEN not set');
    process.exit(1);
  }
  console.log('✓ MOTHERDUCK_TOKEN found');

  // Check AWS credentials for private address database
  const awsAccessKey = process.env.AWS_ACCESS_KEY_ID;
  const awsSecretKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!awsAccessKey || !awsSecretKey) {
    console.error('ERROR: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY required for private S3 bucket');
    process.exit(1);
  }
  console.log('✓ AWS credentials found\n');

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

    // Create a fresh database (drop if exists to avoid lock conflicts)
    const DB_NAME = 'overture_na';  // Changed name to avoid stale locks
    console.log(`Setting up ${DB_NAME} database...`);
    
    try {
      // Try to drop the old database if it has stale locks
      await runExec(`DROP DATABASE IF EXISTS overture_flyr;`);
      console.log('  Cleaned up old overture_flyr database');
    } catch (e: any) {
      // Ignore errors - database might not exist
    }
    
    try {
      await runExec(`DROP DATABASE IF EXISTS ${DB_NAME};`);
      console.log(`  Cleaned up old ${DB_NAME} database`);
    } catch (e: any) {
      // Ignore errors
    }
    
    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await runExec(`CREATE DATABASE ${DB_NAME};`);
    console.log(`✓ Database ${DB_NAME} created\n`);

    // Use the database
    await runExec(`USE ${DB_NAME};`);

    // Fresh database - no need to check/cleanup tables

    // Configuration - Overture for buildings
    const OVERTURE_RELEASE = '2025-12-17.0';
    const OVERTURE_S3_REGION = 'us-west-2';
    const BUILDINGS_BUCKET = `s3://overturemaps-us-west-2/release/${OVERTURE_RELEASE}/theme=buildings/type=building/*`;

    // Configuration - Private address database
    const PRIVATE_S3_REGION = process.env.FLYR_ADDRESSES_S3_REGION || 'us-east-1';
    const PRIVATE_S3_BUCKET = process.env.FLYR_ADDRESSES_S3_BUCKET || 'flyr-pro-addresses-2025';
    const PRIVATE_ADDRESSES_PATH = `s3://${PRIVATE_S3_BUCKET}/master_addresses_parquet/state=*/data_0.parquet`;

    // North America bounding box (US + Canada)
    // Expanded to include all of Canada (up to ~83°N for Arctic islands, but ~72°N for practical coverage)
    const NA_BBOX = {
      west: -141.0,  // Western Alaska/Yukon border
      east: -52.0,   // Eastern Newfoundland
      south: 24.0,   // Southern tip of Florida/Texas
      north: 72.0,   // Northern Canada (covers most populated areas)
    };

    // Set S3 region for Overture (will change for private bucket later)
    await runExec(`SET s3_region='${OVERTURE_S3_REGION}';`);

    // Create buildings table (fresh database, so always create)
    {
      console.log('\n--- Loading US + Canada Buildings ---');
      console.log('This may take 45-75 minutes for the first load...');
      console.log(`Source: ${BUILDINGS_BUCKET}`);
      console.log(`Filter: North America bbox, residential/null subtype, no garage/shed\n`);

      const startBuildings = Date.now();
      
      await runExec(`
        CREATE TABLE buildings AS
        SELECT 
          id as gers_id,
          ST_AsGeoJSON(geometry) as geometry_json,
          bbox.xmin as bbox_west,
          bbox.ymin as bbox_south,
          bbox.xmax as bbox_east,
          bbox.ymax as bbox_north,
          COALESCE(height, (num_floors * 3.5), 8) as height,
          names.primary as name
        FROM read_parquet('${BUILDINGS_BUCKET}', hive_partitioning=1)
        WHERE 
          bbox.xmin BETWEEN ${NA_BBOX.west} AND ${NA_BBOX.east}
          AND bbox.ymin BETWEEN ${NA_BBOX.south} AND ${NA_BBOX.north}
          AND (subtype = 'residential' OR subtype IS NULL)
          AND (class IS NULL OR class NOT IN ('garage', 'shed'))
          AND geometry IS NOT NULL;
      `);

      const buildingTime = Math.round((Date.now() - startBuildings) / 1000);
      console.log(`✓ Buildings loaded in ${buildingTime}s`);

      // Count buildings
      const buildingCount = await runQuery('SELECT COUNT(*) as cnt FROM buildings;');
      console.log(`✓ Total buildings: ${buildingCount[0]?.cnt?.toLocaleString()}\n`);

      // Create spatial index
      console.log('Creating buildings bbox index...');
      await runExec('CREATE INDEX IF NOT EXISTS idx_buildings_bbox ON buildings(bbox_west, bbox_south, bbox_east, bbox_north);');
      console.log('✓ Index created\n');
    }

    // Create addresses table from PRIVATE S3 bucket (your 160M address database)
    {
      console.log('\n--- Loading Private 160M Address Database ---');
      console.log('This may take 20-40 minutes...');
      console.log(`Source: ${PRIVATE_ADDRESSES_PATH}`);
      console.log(`Region: ${PRIVATE_S3_REGION}\n`);

      const startAddresses = Date.now();

      // Switch to private S3 bucket credentials and region
      await runExec(`SET s3_region='${PRIVATE_S3_REGION}';`);
      await runExec(`SET s3_access_key_id='${awsAccessKey}';`);
      await runExec(`SET s3_secret_access_key='${awsSecretKey}';`);

      await runExec(`
        CREATE TABLE addresses AS
        SELECT 
          gers_id,
          ST_AsGeoJSON(ST_Point(longitude, latitude)) as geometry_json,
          longitude as bbox_west,
          latitude as bbox_south,
          longitude as bbox_east,
          latitude as bbox_north,
          house_number,
          street_name,
          COALESCE(unit, '') as unit,
          postal_code,
          city as locality,
          state as region,
          'US' as country,
          formatted
        FROM read_parquet('${PRIVATE_ADDRESSES_PATH}', hive_partitioning=1)
        WHERE 
          latitude IS NOT NULL 
          AND longitude IS NOT NULL
          AND house_number IS NOT NULL 
          AND house_number != ''
          AND street_name IS NOT NULL 
          AND street_name != '';
      `);

      const addressTime = Math.round((Date.now() - startAddresses) / 1000);
      console.log(`✓ Addresses loaded in ${addressTime}s`);

      // Count addresses
      const addressCount = await runQuery('SELECT COUNT(*) as cnt FROM addresses;');
      console.log(`✓ Total addresses: ${addressCount[0]?.cnt?.toLocaleString()}\n`);

      // Create spatial index on lat/lng (for point data, bbox_west=bbox_east, bbox_south=bbox_north)
      console.log('Creating addresses location index...');
      await runExec('CREATE INDEX IF NOT EXISTS idx_addresses_location ON addresses(bbox_south, bbox_west);');
      console.log('✓ Index created\n');
    }

    // Final summary
    console.log('\n=== Setup Complete ===');
    console.log(`Database: ${DB_NAME}`);
    console.log('Tables:');
    console.log('  - buildings: Overture Maps (US + Canada residential)');
    console.log('  - addresses: Your private 160M database (US)');
    console.log('\nYou can now query this data via the MotherDuck HTTP API!');
    console.log('Campaign creation will work on Vercel.');

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  } finally {
    conn.close?.();
    db.close?.();
  }
}

main().catch(console.error);
