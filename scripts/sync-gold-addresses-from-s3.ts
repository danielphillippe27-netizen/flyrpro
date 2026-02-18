#!/usr/bin/env tsx
/**
 * Gold Tier Sync Script (The "Loader")
 * 
 * Downloads clean GeoJSON from S3 and loads into Supabase PostGIS.
 * 
 * Usage:
 *   npx tsx scripts/sync-gold-addresses-from-s3.ts --source=durham_addresses
 *   npx tsx scripts/sync-gold-addresses-from-s3.ts --source=durham_buildings
 *   npx tsx scripts/sync-gold-addresses-from-s3.ts --all
 * 
 * Process:
 *   1. Download GeoJSON from S3
 *   2. DELETE existing rows for this source_id (full refresh)
 *   3. INSERT new rows in batches of 1000
 *   4. Log results to gold_data_sync_log
 */

import { createClient } from '@supabase/supabase-js';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { parseArgs } from 'util';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// ============================================================================
// CONFIGURATION
// ============================================================================

const S3_BUCKET = process.env.AWS_BUCKET_NAME || 'flyr-pro-addresses-2025';
// Bucket is in us-east-2 (Ohio); override with AWS_S3_BUCKET_REGION or AWS_REGION if needed
const S3_REGION = process.env.AWS_S3_BUCKET_REGION || process.env.AWS_REGION || 'us-east-2';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const BATCH_SIZE = 1000; // Smaller batches to avoid Supabase statement timeout on large syncs
const BATCH_DELAY_MS = 150;
const BATCH_RETRIES = 3;
const BATCH_RETRY_DELAY_MS = 2000;
const DELETE_BATCH_SIZE = 500; // Delete in chunks (small enough for .in() request limit)

// Source configuration mapping
interface SourceConfig {
  id: string;
  type: 'address' | 'building';
  s3Key: string;
  table: string;
}

const SOURCE_CONFIGS: SourceConfig[] = [
  {
    id: 'durham_addresses',
    type: 'address',
    s3Key: 'gold-standard/canada/ontario/durham/addresses.geojson',
    table: 'ref_addresses_gold',
  },
  {
    id: 'durham_buildings',
    type: 'building',
    s3Key: 'gold-standard/canada/ontario/durham/buildings.geojson',
    table: 'ref_buildings_gold',
  },
  {
    id: 'toronto_addresses',
    type: 'address',
    s3Key: 'gold-standard/canada/ontario/toronto/addresses.geojson',
    table: 'ref_addresses_gold',
  },
];

// Group names for GitHub Actions (match ingest script groups)
const SYNC_GROUPS: Record<string, string[]> = {
  durham_york_peel: ['durham_addresses', 'durham_buildings'],
  toronto_ottawa: ['toronto_addresses'],
  ontario_rest: [],
  western_canada: [],
  atlantic_canada: [],
};

// ============================================================================
// CLIENTS
// ============================================================================

const s3Client = new S3Client({
  region: S3_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ============================================================================
// TYPES
// ============================================================================

interface GeoJSONFeature {
  type: 'Feature';
  geometry: {
    type: string;
    coordinates: any;
  };
  properties: Record<string, any>;
}

interface GeoJSONCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
  metadata?: {
    source_id: string;
    source_name: string;
    source_url: string;
    fetched_at: string;
    [key: string]: any;
  };
}

interface SyncResult {
  sourceId: string;
  deleted: number;
  inserted: number;
  durationMs: number;
  error?: string;
}

// ============================================================================
// S3 DOWNLOAD
// ============================================================================

async function downloadFromS3(s3Key: string): Promise<GeoJSONCollection> {
  console.log(`Downloading from S3: ${s3Key}`);
  
  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: s3Key,
  });
  
  const response = await s3Client.send(command);
  
  if (!response.Body) {
    throw new Error('Empty response body from S3');
  }
  
  // Convert stream to string
  const chunks: Buffer[] = [];
  for await (const chunk of response.Body as any) {
    chunks.push(chunk);
  }
  
  const jsonString = Buffer.concat(chunks).toString('utf-8');
  const geojson: GeoJSONCollection = JSON.parse(jsonString);
  
  console.log(`  ✓ Downloaded ${geojson.features.length.toLocaleString()} features`);
  
  if (geojson.metadata) {
    console.log(`  Source: ${geojson.metadata.source_name || geojson.metadata.source_id}`);
    console.log(`  Fetched: ${geojson.metadata.fetched_at}`);
  }
  
  return geojson;
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

async function deleteExisting(sourceId: string, table: string): Promise<number> {
  console.log(`\nDeleting existing data from ${table}...`);
  console.log(`  source_id: ${sourceId}`);
  let totalDeleted = 0;
  while (true) {
    const { data: ids, error: selectError } = await supabase
      .from(table)
      .select('id')
      .eq('source_id', sourceId)
      .limit(DELETE_BATCH_SIZE);
    if (selectError) throw new Error(`Delete (select) failed: ${selectError.message}`);
    if (!ids?.length) break;
    const idList = ids.map((r: { id: string }) => r.id);
    let deleteError: any = null;
    for (let attempt = 1; attempt <= BATCH_RETRIES; attempt++) {
      const res = await supabase.from(table).delete().in('id', idList);
      deleteError = res.error;
      if (!deleteError) break;
      const retryable = /fetch failed|ECONNRESET|ETIMEDOUT|network/i.test(deleteError.message || '');
      if (attempt < BATCH_RETRIES && retryable) {
        const delay = BATCH_RETRY_DELAY_MS * attempt;
        console.warn(`    ⚠ Delete batch failed (${deleteError.message}). Retry ${attempt}/${BATCH_RETRIES} in ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw new Error(`Delete failed: ${deleteError.message}`);
      }
    }
    totalDeleted += idList.length;
    if (totalDeleted % 5000 < DELETE_BATCH_SIZE) console.log(`  Deleted ${totalDeleted.toLocaleString()} rows...`);
    if (idList.length < DELETE_BATCH_SIZE) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`  ✓ Deleted ${totalDeleted} rows`);
  return totalDeleted;
}

function getLonLat(feature: GeoJSONFeature): { lon: number; lat: number } | null {
  const g = feature.geometry as Record<string, unknown> | null | undefined;
  const p = feature.properties;
  if (!g) return null;

  // Standard GeoJSON Point: coordinates = [lon, lat]
  const coords = g.coordinates;
  if (coords != null && Array.isArray(coords)) {
    const a = coords.length >= 2 ? coords : coords[0];
    const arr = Array.isArray(a) ? a : coords;
    if (arr && arr.length >= 2) {
      const lon = Number(arr[0]);
      const lat = Number(arr[1]);
      if (Number.isFinite(lon) && Number.isFinite(lat)) return { lon, lat };
    }
  }

  // Esri-style: x, y (or X, Y)
  const x = (g as any).x ?? (g as any).X;
  const y = (g as any).y ?? (g as any).Y;
  if (x != null && y != null) {
    const lon = Number(x);
    const lat = Number(y);
    if (Number.isFinite(lon) && Number.isFinite(lat)) return { lon, lat };
  }

  // Attributes (Toronto layer has LONGITUDE, LATITUDE)
  const lon = Number(p?.LONGITUDE ?? p?.longitude ?? p?.X ?? (p as any)?.x);
  const lat = Number(p?.LATITUDE ?? p?.latitude ?? p?.Y ?? (p as any)?.y);
  if (Number.isFinite(lon) && Number.isFinite(lat)) return { lon, lat };
  return null;
}

function mapAddressFeature(
  feature: GeoJSONFeature,
  sourceId: string,
  sourceFile: string,
  sourceUrl: string
): any | null {
  const props = feature.properties;
  const lonLat = getLonLat(feature);
  if (!lonLat) return null;
  const { lon, lat } = lonLat;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;

  return {
    source_id: sourceId,
    source_file: sourceFile,
    source_url: sourceUrl,
    source_date: props._fetched_at ? props._fetched_at.split('T')[0] : new Date().toISOString().split('T')[0],

    street_number: props.street_number || '',
    street_name: props.street_name || '',
    unit: props.unit || null,
    city: props.city || 'Unknown',
    zip: props.zip || null,
    province: props.province || 'ON',
    country: props.country || 'CA',

    geom: `POINT(${lon} ${lat})`,

    address_type: props.address_type || null,
    precision: props.precision || 'rooftop',
  };
}

function mapBuildingFeature(feature: GeoJSONFeature, sourceId: string, sourceFile: string, sourceUrl: string): any {
  const props = feature.properties;
  const geom = feature.geometry;
  
  // Calculate centroid if not already in properties
  let centroid: string | null = null;
  if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
    // We'll let PostGIS calculate this, or we can do it here
    // For now, leave null and let DB handle it or calculate from coords
    centroid = null;  // Will calculate below
  }
  
  return {
    source_id: sourceId,
    source_file: sourceFile,
    source_url: sourceUrl,
    source_date: props._fetched_at ? props._fetched_at.split('T')[0] : new Date().toISOString().split('T')[0],
    
    external_id: props.external_id ? String(props.external_id) : null,
    parcel_id: props.parcel_id || null,
    
    // PostGIS geometry - GeoJSON string
    geom: JSON.stringify(geom),
    centroid: centroid,  // Will be calculated by trigger or PostGIS function
    
    area_sqm: props.area_sqm || null,
    height_m: props.height_m || props.height || null,
    floors: props.floors || props.NUM_FLOORS || null,
    year_built: props.year_built || props.YEAR_BUILT || null,
    
    building_type: props.building_type || null,
    subtype: props.subtype || null,
    
    primary_address: props.primary_address || null,
    primary_street_number: props.primary_street_number || null,
    primary_street_name: props.primary_street_name || null,
  };
}

async function insertAddresses(features: GeoJSONFeature[], config: SourceConfig, metadata: any): Promise<number> {
  console.log(`\nInserting ${features.length.toLocaleString()} addresses...`);

  const records = features
    .map(f => mapAddressFeature(f, config.id, config.s3Key, metadata?.source_url || ''))
    .filter((r): r is NonNullable<typeof r> => r != null);
  if (records.length < features.length) {
    console.log(`  Skipped ${(features.length - records.length).toLocaleString()} features with invalid geometry.`);
    if (records.length === 0 && features.length > 0) {
      const f0 = features[0];
      const g = f0.geometry;
      console.log('  [debug] First feature geometry keys:', g ? Object.keys(g) : 'null');
      console.log('  [debug] First feature geometry sample:', JSON.stringify(g)?.slice(0, 400));
      console.log('  [debug] First feature props (coord-related):', [
        (f0.properties as any)?.LONGITUDE,
        (f0.properties as any)?.LATITUDE,
        (f0.properties as any)?.longitude,
        (f0.properties as any)?.latitude,
        (f0.properties as any)?.X,
        (f0.properties as any)?.Y,
      ]);
    }
  }

  let inserted = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(records.length / BATCH_SIZE);

    console.log(`  Batch ${batchNum}/${totalBatches}: ${batch.length} records...`);

    let lastError: any = null;
    for (let attempt = 1; attempt <= BATCH_RETRIES; attempt++) {
      const { error } = await supabase.from(config.table).insert(batch);
      if (!error) {
        lastError = null;
        break;
      }
      lastError = error;
      const isRetryable =
        error.message?.includes('fetch failed') ||
        error.message?.includes('ECONNRESET') ||
        error.message?.includes('ETIMEDOUT') ||
        error.message?.includes('network');
      if (attempt < BATCH_RETRIES && isRetryable) {
        const delay = BATCH_RETRY_DELAY_MS * attempt;
        console.warn(`    ⚠ Batch ${batchNum} attempt ${attempt}/${BATCH_RETRIES} failed (${error.message}). Retrying in ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        console.error(`    ✗ Batch ${batchNum} failed:`, error.message);
        throw error;
      }
    }
    if (lastError) throw lastError;

    inserted += batch.length;

    if (i + BATCH_SIZE < records.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }
  
  console.log(`  ✓ Inserted ${inserted.toLocaleString()} addresses`);
  return inserted;
}

async function insertBuildings(features: GeoJSONFeature[], config: SourceConfig, metadata: any): Promise<number> {
  console.log(`\nInserting ${features.length.toLocaleString()} buildings...`);
  
  // Map features to records
  const records = features.map(f => 
    mapBuildingFeature(f, config.id, config.s3Key, metadata?.source_url || '')
  );
  
  let inserted = 0;
  
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(records.length / BATCH_SIZE);
    
    console.log(`  Batch ${batchNum}/${totalBatches}: ${batch.length} records...`);
    
    // For buildings, we need to handle geometry properly
    // Build a raw SQL query for batch insert with PostGIS functions
    const values = batch.map(r => {
      const geomSql = `ST_SetSRID(ST_GeomFromGeoJSON('${r.geom}'), 4326)`;
      const centroidSql = `ST_Centroid(${geomSql})`;
      
      return `(
        '${r.source_id}',
        '${r.source_file}',
        ${r.source_url ? `'${r.source_url}'` : 'NULL'},
        ${r.source_date ? `'${r.source_date}'` : 'NULL'},
        ${r.external_id ? `'${r.external_id}'` : 'NULL'},
        ${r.parcel_id ? `'${r.parcel_id}'` : 'NULL'},
        ${geomSql},
        ${centroidSql},
        ${r.area_sqm || 'NULL'},
        ${r.height_m || 'NULL'},
        ${r.floors || 'NULL'},
        ${r.year_built || 'NULL'},
        ${r.building_type ? `'${r.building_type}'` : 'NULL'},
        ${r.subtype ? `'${r.subtype}'` : 'NULL'},
        ${r.primary_address ? `'${r.primary_address.replace(/'/g, "''")}'` : 'NULL'},
        ${r.primary_street_number ? `'${r.primary_street_number}'` : 'NULL'},
        ${r.primary_street_name ? `'${r.primary_street_name.replace(/'/g, "''")}'` : 'NULL'}
      )`;
    }).join(',\n');
    
    const sql = `
      INSERT INTO ${config.table} (
        source_id, source_file, source_url, source_date,
        external_id, parcel_id, geom, centroid,
        area_sqm, height_m, floors, year_built,
        building_type, subtype, primary_address, primary_street_number, primary_street_name
      ) VALUES ${values}
    `;
    
    const { error } = await supabase.rpc('exec_sql', { sql });
    
    // If exec_sql RPC doesn't exist, fall back to regular insert
    if (error && error.message.includes('exec_sql')) {
      console.log('    Note: Using standard insert (exec_sql RPC not available)');
      
      // Simplified insert without geometry calculations
      const simpleRecords = batch.map(r => ({
        ...r,
        geom: undefined,  // Will need to be handled differently
      }));
      
      const { error: insertError } = await supabase
        .from(config.table)
        .insert(batch);
      
      if (insertError) {
        console.error(`    ✗ Batch ${batchNum} failed:`, insertError.message);
        throw insertError;
      }
    } else if (error) {
      console.error(`    ✗ Batch ${batchNum} failed:`, error.message);
      throw error;
    }
    
    inserted += batch.length;
    
    // Small delay between batches
    if (i + BATCH_SIZE < records.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }
  
  console.log(`  ✓ Inserted ${inserted.toLocaleString()} buildings`);
  return inserted;
}

async function logSync(
  config: SourceConfig,
  result: SyncResult,
  metadata: any,
  dryRun: boolean
): Promise<void> {
  if (dryRun) return;
  
  const { error } = await supabase
    .from('gold_data_sync_log')
    .insert({
      source_id: config.id,
      source_type: config.type,
      s3_bucket: S3_BUCKET,
      s3_key: config.s3Key,
      records_fetched: result.deleted + result.inserted,
      records_inserted: result.inserted,
      records_deleted: result.deleted,
      sync_status: result.error ? 'failed' : 'success',
      error_message: result.error,
      sync_duration_ms: result.durationMs,
      sync_completed_at: new Date().toISOString(),
      arcgis_url: metadata?.source_url,
      metadata: {
        source_name: metadata?.source_name,
        fetched_at: metadata?.fetched_at,
      },
    });
  
  if (error) {
    console.warn('Warning: Failed to log sync:', error.message);
  }
}

// ============================================================================
// MAIN SYNC FUNCTION
// ============================================================================

async function syncSource(config: SourceConfig, dryRun: boolean): Promise<SyncResult> {
  const startTime = Date.now();
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Syncing: ${config.id}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Type: ${config.type}`);
  console.log(`Table: ${config.table}`);
  console.log(`S3: ${config.s3Key}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  
  const result: SyncResult = {
    sourceId: config.id,
    deleted: 0,
    inserted: 0,
    durationMs: 0,
  };
  
  let geojson: GeoJSONCollection | null = null;
  
  try {
    // 1. Download from S3
    geojson = await downloadFromS3(config.s3Key);
    
    if (dryRun) {
      console.log('\n[DRY RUN] Would perform:');
      console.log(`  DELETE FROM ${config.table} WHERE source_id = '${config.id}'`);
      console.log(`  INSERT ${geojson.features.length.toLocaleString()} rows`);
      result.inserted = geojson.features.length;
      
    } else {
      // 2. Delete existing
      result.deleted = await deleteExisting(config.id, config.table);
      
      // 3. Insert new
      if (config.type === 'address') {
        result.inserted = await insertAddresses(geojson.features, config, geojson.metadata);
      } else {
        result.inserted = await insertBuildings(geojson.features, config, geojson.metadata);
      }
    }
    
  } catch (error: any) {
    result.error = error.message;
    console.error(`\n✗ Sync failed:`, error.message);
  }
  
  result.durationMs = Date.now() - startTime;
  
  // Log
  await logSync(config, result, geojson?.metadata || null, dryRun);
  
  console.log(`\n  Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
  console.log(`  Deleted: ${result.deleted.toLocaleString()}`);
  console.log(`  Inserted: ${result.inserted.toLocaleString()}`);
  console.log(`  Status: ${result.error ? 'FAILED' : 'SUCCESS'}`);
  
  return result;
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      source: { type: 'string' },
      group: { type: 'string' },
      all: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      'list-sources': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  
  if (values.help) {
    console.log(`
Gold Tier Sync Script (The "Loader")

Downloads GeoJSON from S3 and loads into Supabase PostGIS.

Usage:
  npx tsx scripts/sync-gold-addresses-from-s3.ts [options]

Options:
  --source=<id>       Sync specific source (e.g., toronto_addresses)
  --group=<name>      Sync sources in group (e.g., toronto_ottawa)
  --all               Sync all configured sources
  --dry-run           Preview changes without modifying database
  --list-sources      List available sources
  --help              Show this help

Examples:
  # Sync Durham addresses
  npx tsx scripts/sync-gold-addresses-from-s3.ts --source=durham_addresses

  # Sync Durham buildings
  npx tsx scripts/sync-gold-addresses-from-s3.ts --source=durham_buildings

  # Test without database changes
  npx tsx scripts/sync-gold-addresses-from-s3.ts --source=durham_addresses --dry-run

  # Sync everything
  npx tsx scripts/sync-gold-addresses-from-s3.ts --all

Environment Variables:
  NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
  AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_BUCKET_NAME
  AWS_REGION or AWS_S3_BUCKET_REGION (default: us-east-2 for Ohio bucket)
    `);
    process.exit(0);
  }
  
  if (values['list-sources']) {
    console.log('Configured sources:\n');
    SOURCE_CONFIGS.forEach(s => {
      console.log(`${s.id}`);
      console.log(`  Type: ${s.type}`);
      console.log(`  Table: ${s.table}`);
      console.log(`  S3: ${s.s3Key}\n`);
    });
    process.exit(0);
  }
  
  // Validate environment
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Error: Supabase credentials not found');
    console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('Error: AWS credentials not found');
    process.exit(1);
  }
  
  // Determine sources
  let configs: SourceConfig[] = [];
  
  if (values.all) {
    configs = SOURCE_CONFIGS;
  } else if (values.group) {
    const ids = SYNC_GROUPS[values.group];
    if (!ids?.length) {
      console.error(`Unknown or empty group: ${values.group}`);
      console.log('Available:', Object.keys(SYNC_GROUPS).join(', '));
      process.exit(1);
    }
    configs = SOURCE_CONFIGS.filter(s => ids.includes(s.id));
  } else if (values.source) {
    const config = SOURCE_CONFIGS.find(s => s.id === values.source);
    if (!config) {
      console.error(`Unknown source: ${values.source}`);
      console.log('Available:', SOURCE_CONFIGS.map(s => s.id).join(', '));
      process.exit(1);
    }
    configs = [config];
  } else {
    console.error('Error: Must specify --source=<id>, --group=<name>, or --all');
    process.exit(1);
  }
  
  const dryRun = values['dry-run'] || false;
  
  console.log('========================================');
  console.log('Gold Tier Sync (The "Loader")');
  console.log('========================================');
  console.log(`S3: ${S3_BUCKET} (region: ${S3_REGION})`);
  console.log(`Sources: ${configs.length}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log('');
  
  // Process each source
  const results: SyncResult[] = [];
  
  for (const config of configs) {
    const result = await syncSource(config, dryRun);
    results.push(result);
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  
  let successCount = 0;
  let failCount = 0;
  
  for (const r of results) {
    const status = r.error ? '❌ FAILED' : '✅ SUCCESS';
    console.log(`\n${r.sourceId}: ${status}`);
    console.log(`  Deleted: ${r.deleted.toLocaleString()}`);
    console.log(`  Inserted: ${r.inserted.toLocaleString()}`);
    console.log(`  Duration: ${(r.durationMs / 1000).toFixed(1)}s`);
    if (r.error) {
      console.log(`  Error: ${r.error}`);
      failCount++;
    } else {
      successCount++;
    }
  }
  
  console.log('\n' + '-'.repeat(60));
  console.log(`Total: ${results.length} | Success: ${successCount} | Failed: ${failCount}`);
  console.log('='.repeat(60));
  
  if (failCount > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
