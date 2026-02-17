#!/usr/bin/env tsx
/**
 * Load Regional Data from S3 to Supabase
 * 
 * This script loads a geographic subset of the 160M addresses and Overture buildings
 * from S3 into Supabase when a user defines a campaign area.
 * 
 * Architecture:
 *   S3 (Data Lake)  →  Supabase (Hot Cache)  →  App
 *   160M addresses       Regional subset          Resolution
 *   
 * Usage:
 *   npx tsx scripts/load-regional-data.ts --campaign=<campaign_id>
 *   npx tsx scripts/load-regional-data.ts --bbox=-79.5,43.6,-79.3,43.8
 * 
 * The script:
 * 1. Reads campaign bbox from Supabase OR uses provided bbox
 * 2. Queries S3 parquet files using DuckDB (with spatial filtering)
 * 3. Upserts matching records into Supabase
 * 4. Updates load log
 */

import { createClient } from '@supabase/supabase-js';
import duckdb from 'duckdb';
import { parseArgs } from 'util';

// ============================================================================
// CONFIGURATION
// ============================================================================

const S3_BUCKET = process.env.AWS_BUCKET_NAME || 'flyr-pro-addresses-2025';

const S3_PATHS = {
  addresses: process.env.S3_SILVER_ADDRESSES || 's3://flyr-pro-data/addresses/silver/na_addresses.parquet',
  buildings: process.env.S3_OVERTURE_BUILDINGS || 's3://flyr-pro-data/buildings/overture/na_buildings.parquet',
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// DuckDB settings
const DUCKDB_MEMORY_LIMIT = '4GB';
const BATCH_SIZE = 5000;

// ============================================================================
// TYPES
// ============================================================================

interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

interface LoadResult {
  type: 'addresses' | 'buildings';
  loaded: number;
  skipped: number;
  durationMs: number;
  error?: string;
}

// ============================================================================
// DUCKDB SETUP
// ============================================================================

async function createDuckDBConnection() {
  console.log('Initializing DuckDB...');
  
  const db = new duckdb.Database(':memory:');
  const conn = db.connect();
  
  const exec = (sql: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      conn.exec(sql, (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });
  };
  
  // Load extensions
  await exec('INSTALL spatial; LOAD spatial;');
  await exec('INSTALL httpfs; LOAD httpfs;');
  
  // Configure S3 credentials
  await exec(`SET s3_access_key_id='${process.env.AWS_ACCESS_KEY_ID}';`);
  await exec(`SET s3_secret_access_key='${process.env.AWS_SECRET_ACCESS_KEY}';`);
  await exec(`SET s3_region='${process.env.AWS_REGION || 'us-east-1'}';`);
  
  // Memory limit
  await exec(`SET memory_limit = '${DUCKDB_MEMORY_LIMIT}';`);
  
  console.log('✓ DuckDB initialized');
  
  return { db, conn, exec };
}

// ============================================================================
// S3 QUERY FUNCTIONS
// ============================================================================

async function queryAddressesFromS3(
  conn: duckdb.Connection,
  bbox: BoundingBox,
  onBatch: (rows: any[]) => Promise<void>
): Promise<{ count: number; error?: string }> {
  console.log('\nQuerying addresses from S3...');
  console.log(`  BBOX: [${bbox.west}, ${bbox.south}, ${bbox.east}, ${bbox.north}]`);
  console.log(`  Source: ${S3_PATHS.addresses}`);
  
  const allQuery = `
    SELECT * FROM read_parquet('${S3_PATHS.addresses}')
    WHERE lon BETWEEN ${bbox.west} AND ${bbox.east}
      AND lat BETWEEN ${bbox.south} AND ${bbox.north}
  `;
  
  // First get count
  const countQuery = `SELECT COUNT(*) as count FROM (${allQuery})`;
  const countResult = await new Promise<any[]>((resolve, reject) => {
    conn.all(countQuery, (err: any, res: any) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
  
  const totalCount = countResult[0]?.count || 0;
  console.log(`  Estimated matches: ${totalCount.toLocaleString()}`);
  
  if (totalCount === 0) {
    return { count: 0 };
  }
  
  if (totalCount > 500000) {
    console.warn(`  WARNING: Large result set (${totalCount.toLocaleString()}). Consider smaller bbox.`);
  }
  
  // Stream results in batches using LIMIT/OFFSET
  let offset = 0;
  let hasMore = true;
  let totalLoaded = 0;
  
  while (hasMore && offset < totalCount) {
    const batchQuery = `${allQuery} LIMIT ${BATCH_SIZE} OFFSET ${offset}`;
    
    const rows = await new Promise<any[]>((resolve, reject) => {
      conn.all(batchQuery, (err: any, res: any) => {
        if (err) reject(err);
        else resolve(res || []);
      });
    });
    
    if (rows.length === 0) {
      hasMore = false;
      break;
    }
    
    await onBatch(rows);
    totalLoaded += rows.length;
    offset += rows.length;
    
    if (offset % 50000 === 0) {
      console.log(`    Progress: ${totalLoaded.toLocaleString()} / ${totalCount.toLocaleString()}`);
    }
  }
  
  console.log(`  ✓ Loaded ${totalLoaded.toLocaleString()} addresses`);
  return { count: totalLoaded };
}

async function queryBuildingsFromS3(
  conn: duckdb.Connection,
  bbox: BoundingBox,
  onBatch: (rows: any[]) => Promise<void>
): Promise<{ count: number; error?: string }> {
  console.log('\nQuerying buildings from S3...');
  console.log(`  BBOX: [${bbox.west}, ${bbox.south}, ${bbox.east}, ${bbox.north}]`);
  console.log(`  Source: ${S3_PATHS.buildings}`);
  
  // Overture buildings are in GeoParquet format with geometry column
  const allQuery = `
    SELECT 
      gers_id,
      ST_X(ST_Centroid(geom)) as centroid_lon,
      ST_Y(ST_Centroid(geom)) as centroid_lat,
      ST_AsGeoJSON(geom) as geometry_json,
      height,
      names->>'primary' as house_name,
      addresses[1]->>'house_number' as addr_housenumber,
      addresses[1]->>'street' as addr_street,
      addresses[1]->>'unit' as addr_unit,
      confidence
    FROM read_parquet('${S3_PATHS.buildings}')
    WHERE ST_Intersects(geom, ST_MakeEnvelope(${bbox.west}, ${bbox.south}, ${bbox.east}, ${bbox.north}))
      AND ST_GeometryType(geom) IN ('POLYGON', 'MULTIPOLYGON')
  `;
  
  // Get count
  const countQuery = `SELECT COUNT(*) as count FROM (${allQuery})`;
  const countResult = await new Promise<any[]>((resolve, reject) => {
    conn.all(countQuery, (err: any, res: any) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
  
  const totalCount = countResult[0]?.count || 0;
  console.log(`  Estimated matches: ${totalCount.toLocaleString()}`);
  
  if (totalCount === 0) {
    return { count: 0 };
  }
  
  // Stream in batches
  let offset = 0;
  let hasMore = true;
  let totalLoaded = 0;
  
  while (hasMore && offset < totalCount) {
    const batchQuery = `${allQuery} LIMIT ${BATCH_SIZE} OFFSET ${offset}`;
    
    const rows = await new Promise<any[]>((resolve, reject) => {
      conn.all(batchQuery, (err: any, res: any) => {
        if (err) reject(err);
        else resolve(res || []);
      });
    });
    
    if (rows.length === 0) {
      hasMore = false;
      break;
    }
    
    await onBatch(rows);
    totalLoaded += rows.length;
    offset += rows.length;
    
    if (offset % 50000 === 0) {
      console.log(`    Progress: ${totalLoaded.toLocaleString()} / ${totalCount.toLocaleString()}`);
    }
  }
  
  console.log(`  ✓ Loaded ${totalLoaded.toLocaleString()} buildings`);
  return { count: totalLoaded };
}

// ============================================================================
// SUPABASE UPSERT FUNCTIONS
// ============================================================================

async function upsertAddresses(
  supabase: any,
  campaignId: string,
  bbox: BoundingBox,
  rows: any[]
): Promise<{ inserted: number; error?: string }> {
  // Transform DuckDB rows to Supabase schema
  const records = rows.map(row => ({
    street_number: row.house_number || row.street_number || '',
    street_name: row.street || row.street_name || '',
    unit: row.unit || null,
    city: row.locality || row.city || 'Unknown',
    province: row.region || row.province || 'ON',
    postal_code: row.postcode || row.postal_code || null,
    geom: `SRID=4326;POINT(${row.lon} ${row.lat})`,
    source_dataset: row.source_dataset || 'openaddresses_na',
    precision: 'interpolated',
    confidence: row.confidence || 0.7,
    s3_source_path: S3_PATHS.addresses,
    loaded_for_campaign_id: campaignId,
    loaded_at: new Date().toISOString(),
    bbox_bounds: `SRID=4326;POLYGON((${bbox.west} ${bbox.south}, ${bbox.east} ${bbox.south}, ${bbox.east} ${bbox.north}, ${bbox.west} ${bbox.north}, ${bbox.west} ${bbox.south}))`,
  }));
  
  // Batch upsert
  const { error } = await supabase
    .from('ref_addresses_silver')
    .upsert(records, {
      onConflict: 'street_number_normalized,street_name_normalized,city,province,unit,source_dataset',
      ignoreDuplicates: true,
    });
  
  if (error) {
    return { inserted: 0, error: error.message };
  }
  
  return { inserted: records.length };
}

async function upsertBuildings(
  supabase: any,
  campaignId: string,
  bbox: BoundingBox,
  rows: any[]
): Promise<{ inserted: number; error?: string }> {
  // Transform DuckDB rows to Supabase schema
  const records = rows.map(row => ({
    gers_id: row.gers_id,
    geom: row.geometry_json,  // Already GeoJSON from DuckDB
    centroid: `SRID=4326;POINT(${row.centroid_lon} ${row.centroid_lat})`,
    height: row.height || null,
    house_name: row.house_name || null,
    addr_housenumber: row.addr_housenumber || null,
    addr_street: row.addr_street || null,
    addr_unit: row.addr_unit || null,
    confidence: row.confidence || null,
    s3_source_path: S3_PATHS.buildings,
    loaded_for_campaign_id: campaignId,
    loaded_at: new Date().toISOString(),
    bbox_bounds: `SRID=4326;POLYGON((${bbox.west} ${bbox.south}, ${bbox.east} ${bbox.south}, ${bbox.east} ${bbox.north}, ${bbox.west} ${bbox.north}, ${bbox.west} ${bbox.south}))`,
  }));
  
  // Batch upsert
  const { error } = await supabase
    .from('overture_buildings')
    .upsert(records, {
      onConflict: 'gers_id',
      ignoreDuplicates: true,
    });
  
  if (error) {
    return { inserted: 0, error: error.message };
  }
  
  return { inserted: records.length };
}

// ============================================================================
// MAIN LOAD FUNCTION
// ============================================================================

async function loadRegionalData(
  campaignId: string,
  bbox: BoundingBox,
  loadAddresses: boolean,
  loadBuildings: boolean
): Promise<void> {
  const startTime = Date.now();
  
  console.log('========================================');
  console.log('Regional Data Load: S3 → Supabase');
  console.log('========================================');
  console.log(`Campaign: ${campaignId}`);
  console.log(`BBOX: [${bbox.west}, ${bbox.south}, ${bbox.east}, ${bbox.north}]`);
  console.log(`Load addresses: ${loadAddresses}`);
  console.log(`Load buildings: ${loadBuildings}`);
  console.log('');
  
  // Initialize connections
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { conn, exec } = await createDuckDBConnection();
  
  // Create log entry
  if (loadAddresses) {
    await supabase.from('regional_data_load_log').insert({
      campaign_id: campaignId,
      data_type: 'silver_addresses',
      s3_source_path: S3_PATHS.addresses,
      bbox: `SRID=4326;POLYGON((${bbox.west} ${bbox.south}, ${bbox.east} ${bbox.south}, ${bbox.east} ${bbox.north}, ${bbox.west} ${bbox.north}, ${bbox.west} ${bbox.south}))`,
      load_status: 'running',
    });
  }
  
  if (loadBuildings) {
    await supabase.from('regional_data_load_log').insert({
      campaign_id: campaignId,
      data_type: 'overture_buildings',
      s3_source_path: S3_PATHS.buildings,
      bbox: `SRID=4326;POLYGON((${bbox.west} ${bbox.south}, ${bbox.east} ${bbox.south}, ${bbox.east} ${bbox.north}, ${bbox.west} ${bbox.north}, ${bbox.west} ${bbox.south}))`,
      load_status: 'running',
    });
  }
  
  let addressResult: { loaded: number; error?: string } = { loaded: 0 };
  let buildingResult: { loaded: number; error?: string } = { loaded: 0 };
  
  try {
    // Load addresses
    if (loadAddresses) {
      const addressStart = Date.now();
      let totalLoaded = 0;
      let totalSkipped = 0;
      
      const { count, error } = await queryAddressesFromS3(conn, bbox, async (batch) => {
        const { inserted, error } = await upsertAddresses(supabase, campaignId, bbox, batch);
        if (error) {
          console.warn(`  Batch error: ${error}`);
          totalSkipped += batch.length;
        } else {
          totalLoaded += inserted;
        }
      });
      
      addressResult = {
        loaded: totalLoaded,
        error,
      };
      
      // Update log
      await supabase
        .from('regional_data_load_log')
        .update({
          records_loaded: totalLoaded,
          records_skipped: totalSkipped,
          load_status: error ? 'failed' : 'success',
          error_message: error,
          load_duration_ms: Date.now() - addressStart,
          completed_at: new Date().toISOString(),
        })
        .eq('campaign_id', campaignId)
        .eq('data_type', 'silver_addresses')
        .is('completed_at', null);
    }
    
    // Load buildings
    if (loadBuildings) {
      const buildingStart = Date.now();
      let totalLoaded = 0;
      let totalSkipped = 0;
      
      const { count, error } = await queryBuildingsFromS3(conn, bbox, async (batch) => {
        const { inserted, error } = await upsertBuildings(supabase, campaignId, bbox, batch);
        if (error) {
          console.warn(`  Batch error: ${error}`);
          totalSkipped += batch.length;
        } else {
          totalLoaded += inserted;
        }
      });
      
      buildingResult = {
        loaded: totalLoaded,
        error,
      };
      
      // Update log
      await supabase
        .from('regional_data_load_log')
        .update({
          records_loaded: totalLoaded,
          records_skipped: totalSkipped,
          load_status: error ? 'failed' : 'success',
          error_message: error,
          load_duration_ms: Date.now() - buildingStart,
          completed_at: new Date().toISOString(),
        })
        .eq('campaign_id', campaignId)
        .eq('data_type', 'overture_buildings')
        .is('completed_at', null);
    }
    
  } finally {
    // Cleanup
    await exec('CHECKPOINT');
  }
  
  const duration = Date.now() - startTime;
  
  // Print summary
  console.log('\n========================================');
  console.log('Load Complete');
  console.log('========================================');
  console.log(`Duration: ${(duration / 1000).toFixed(1)}s`);
  
  if (loadAddresses) {
    console.log(`\nAddresses:`);
    console.log(`  Loaded: ${addressResult.loaded.toLocaleString()}`);
    if (addressResult.error) console.log(`  Error: ${addressResult.error}`);
  }
  
  if (loadBuildings) {
    console.log(`\nBuildings:`);
    console.log(`  Loaded: ${buildingResult.loaded.toLocaleString()}`);
    if (buildingResult.error) console.log(`  Error: ${buildingResult.error}`);
  }
  
  console.log('\nNow you can use resolve_address_point_v2() for this campaign');
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      campaign: { type: 'string' },
      bbox: { type: 'string' },
      'no-addresses': { type: 'boolean' },
      'no-buildings': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  
  if (values.help) {
    console.log(`
Load Regional Data from S3 to Supabase

Usage:
  npx tsx scripts/load-regional-data.ts --campaign=<campaign_id> [options]
  npx tsx scripts/load-regional-data.ts --bbox=west,south,east,north [options]

Options:
  --campaign=<id>     Load data for a specific campaign (reads bbox from DB)
  --bbox=<w,s,e,n>    Load data for a specific bbox (comma-separated)
  --no-addresses      Skip loading addresses
  --no-buildings      Skip loading buildings
  --help              Show this help

Environment Variables:
  NEXT_PUBLIC_SUPABASE_URL      Supabase URL
  SUPABASE_SERVICE_ROLE_KEY     Supabase service key
  AWS_ACCESS_KEY_ID             AWS credentials
  AWS_SECRET_ACCESS_KEY         AWS credentials
  AWS_REGION                    AWS region
  S3_SILVER_ADDRESSES           S3 path to addresses parquet (optional)
  S3_OVERTURE_BUILDINGS         S3 path to buildings parquet (optional)

Examples:
  # Load for campaign (reads bbox from campaigns table)
  npx tsx scripts/load-regional-data.ts --campaign=uuid-here

  # Load specific bbox
  npx tsx scripts/load-regional-data.ts --bbox=-79.5,43.6,-79.3,43.8

  # Load only buildings
  npx tsx scripts/load-regional-data.ts --campaign=uuid --no-addresses
    `);
    process.exit(0);
  }
  
  // Validate environment
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Error: Missing Supabase environment variables');
    process.exit(1);
  }
  
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('Error: Missing AWS environment variables');
    process.exit(1);
  }
  
  let campaignId: string;
  let bbox: BoundingBox;
  
  // Get bbox from campaign or args
  if (values.campaign) {
    campaignId = values.campaign;
    
    // Fetch campaign bbox from Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: campaign, error } = await supabase
      .from('campaigns')
      .select('id, name, bbox')
      .eq('id', campaignId)
      .single();
    
    if (error || !campaign) {
      console.error(`Error: Campaign not found: ${campaignId}`);
      process.exit(1);
    }
    
    if (!campaign.bbox || campaign.bbox.length !== 4) {
      console.error(`Error: Campaign has no valid bbox`);
      process.exit(1);
    }
    
    bbox = {
      west: campaign.bbox[0],
      south: campaign.bbox[1],
      east: campaign.bbox[2],
      north: campaign.bbox[3],
    };
    
    console.log(`Campaign: ${campaign.name}`);
    
  } else if (values.bbox) {
    const parts = values.bbox.split(',').map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) {
      console.error('Error: Invalid bbox format. Use: west,south,east,north');
      process.exit(1);
    }
    
    campaignId = `manual-${Date.now()}`;
    bbox = {
      west: parts[0],
      south: parts[1],
      east: parts[2],
      north: parts[3],
    };
    
  } else {
    console.error('Error: Must specify --campaign or --bbox');
    console.log('Use --help for usage information');
    process.exit(1);
  }
  
  // Run load
  await loadRegionalData(
    campaignId,
    bbox,
    !values['no-addresses'],
    !values['no-buildings']
  );
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
