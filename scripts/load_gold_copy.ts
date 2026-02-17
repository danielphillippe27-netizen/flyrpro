#!/usr/bin/env tsx
/**
 * Gold Tier PostgreSQL COPY Loader (Fastest Method)
 * 
 * Uses PostgreSQL COPY command for maximum speed.
 * Streams data from S3 directly to the database.
 * 
 * Usage:
 *   npx tsx scripts/load_gold_copy.ts --source=durham_addresses
 *   npx tsx scripts/load_gold_copy.ts --source=durham_buildings
 * 
 * Prerequisites:
 *   npm install pg @types/pg
 *   psql command line tool installed
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { exec } from 'child_process';
import { promisify } from 'util';
import { parseArgs } from 'util';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

dotenv.config({ path: '.env.local' });

const execAsync = promisify(exec);

// ============================================================================
// CONFIGURATION
// ============================================================================

const S3_BUCKET = process.env.AWS_BUCKET_NAME || 'flyr-pro-addresses-2025';
const S3_REGION = process.env.AWS_REGION || 'us-east-2';

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
];

// ============================================================================
// S3 CLIENT
// ============================================================================

const s3Client = new S3Client({
  region: S3_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// ============================================================================
// CSV CONVERSION
// ============================================================================

interface GeoJSONFeature {
  type: 'Feature';
  geometry: {
    type: string;
    coordinates: any;
  };
  properties: Record<string, any>;
}

function featuresToCSV(features: GeoJSONFeature[], sourceId: string, sourceFile: string, type: 'address' | 'building'): string {
  const rows: string[] = [];
  
  for (const f of features) {
    const p = f.properties;
    const coords = f.geometry.coordinates;
    
    if (type === 'address') {
      // Build street number with suffix
      let streetNumber = p.CIVIC_NUM || p.street_number || '';
      const suffix = p.CIVIC_SFX || p.street_number_suffix;
      if (suffix) streetNumber += suffix;
      
      // Build street name
      let streetName = p.street_name;
      if (!streetName && p.ROAD_NAME) {
        const parts = [p.ROAD_NAME, p.ROAD_TYPE, p.ROAD_DIR].filter(Boolean);
        streetName = parts.join(' ');
      }
      
      // Build unit
      let unit = p.unit;
      if (!unit && (p.UNIT_NUM || p.UNIT)) {
        const unitType = p.UNIT_TYPE;
        const unitNum = p.UNIT_NUM || p.UNIT;
        unit = unitType && unitNum ? `${unitType} ${unitNum}` : unitNum;
      }
      
      // CSV format: source_id, source_file, street_number, street_name, unit, city, zip, province, country, lon, lat
      const city = (p.MUNICIPALITY || p.city || p.TOWN || 'Unknown').replace(/,/g, ' ');
      const zip = (p.POSTAL_CODE || p.zip || p.POSTAL_CD || '').replace(/,/g, '');
      const geom = `${coords[0]},${coords[1]}`;
      
      rows.push(`${sourceId},${sourceFile},${streetNumber},${streetName || ''},${unit || ''},${city},${zip},ON,CA,${geom}`);
    } else {
      // Building CSV: source_id, source_file, external_id, area_sqm, geom_json
      const area = p.area_sqm || p['Shape.STArea()'] || p.Shape_Area || p.AREA || '';
      const externalId = String(p.OBJECTID || p.GlobalID || p.external_id || '');
      const geomJson = JSON.stringify(f.geometry).replace(/"/g, '""');
      
      rows.push(`${sourceId},${sourceFile},${externalId},${area},"${geomJson}"`);
    }
  }
  
  return rows.join('\n');
}

// ============================================================================
// MAIN LOAD FUNCTION
// ============================================================================

async function loadWithCopy(config: SourceConfig): Promise<{ success: boolean; count: number; error?: string }> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Loading: ${config.id}`);
  console.log(`Table: ${config.table}`);
  console.log(`Method: PostgreSQL COPY`);
  console.log(`${'='.repeat(60)}`);
  
  const tempFile = path.join(os.tmpdir(), `${config.id}_load.csv`);
  
  try {
    // 1. Download from S3
    console.log(`⬇️  Downloading ${config.s3Key} from S3...`);
    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: config.s3Key,
    });
    
    const response = await s3Client.send(command);
    const jsonString = await response.Body?.transformToString();
    const geojson = JSON.parse(jsonString || '{}');
    const features: GeoJSONFeature[] = geojson.features;
    
    console.log(`📦 Loaded ${features.length.toLocaleString()} features`);
    
    // 2. Convert to CSV
    console.log(`📝 Converting to CSV...`);
    const csv = featuresToCSV(features, config.id, config.s3Key, config.type);
    fs.writeFileSync(tempFile, csv);
    console.log(`   CSV file: ${tempFile} (${(fs.statSync(tempFile).size / 1024 / 1024).toFixed(1)} MB)`);
    
    // 3. Delete existing data via psql
    console.log(`🧹 Deleting old data where source_id = '${config.id}'...`);
    const deleteCmd = `psql "${process.env.DATABASE_URL}" -c "DELETE FROM ${config.table} WHERE source_id = '${config.id}';"`;
    await execAsync(deleteCmd);
    
    // 4. COPY data via psql
    console.log(`🚀 COPY data to ${config.table}...`);
    let copyCmd: string;
    
    if (config.type === 'address') {
      // Create temp table, load, then insert with geometry conversion
      copyCmd = `
        psql "${process.env.DATABASE_URL}" -c "
          CREATE TEMP TABLE temp_load (
            source_id text, source_file text, street_number text, street_name text, 
            unit text, city text, zip text, province text, country text,
            lon float, lat float
          );
          COPY temp_load FROM '${tempFile}' WITH (FORMAT csv);
          INSERT INTO ${config.table} (
            source_id, source_file, street_number, street_name, unit, city, zip, province, country, geom
          )
          SELECT 
            source_id, source_file, street_number, street_name, unit, city, zip, province, country,
            ST_SetSRID(ST_MakePoint(lon, lat), 4326)
          FROM temp_load;
          DROP TABLE temp_load;
        "
      `;
    } else {
      copyCmd = `
        psql "${process.env.DATABASE_URL}" -c "
          CREATE TEMP TABLE temp_load (
            source_id text, source_file text, external_id text, area_sqm float, geom_json text
          );
          COPY temp_load FROM '${tempFile}' WITH (FORMAT csv);
          INSERT INTO ${config.table} (
            source_id, source_file, external_id, area_sqm, geom, centroid
          )
          SELECT 
            source_id, source_file, external_id, area_sqm,
            ST_SetSRID(ST_GeomFromGeoJSON(geom_json), 4326),
            ST_SetSRID(ST_Centroid(ST_GeomFromGeoJSON(geom_json)), 4326)
          FROM temp_load;
          DROP TABLE temp_load;
        "
      `;
    }
    
    const { stderr } = await execAsync(copyCmd);
    if (stderr && !stderr.includes('NOTICE')) {
      console.warn(`   Warning: ${stderr}`);
    }
    
    console.log(`✅ SUCCESS! Loaded ${features.length.toLocaleString()} rows.`);
    
    return { success: true, count: features.length };
    
  } catch (err: any) {
    console.error('❌ FAILED!', err.message);
    return { success: false, count: 0, error: err.message };
  } finally {
    // Cleanup
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      source: { type: 'string' },
      all: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  
  if (values.help) {
    console.log(`
Gold Tier PostgreSQL COPY Loader (Fastest Method)

Uses PostgreSQL COPY command for maximum bulk loading speed.

Usage:
  npx tsx scripts/load_gold_copy.ts --source=durham_addresses
  npx tsx scripts/load_gold_copy.ts --source=durham_buildings
  npx tsx scripts/load_gold_copy.ts --all

Environment Variables:
  DATABASE_URL          PostgreSQL connection string
  AWS_ACCESS_KEY_ID     AWS credentials
  AWS_SECRET_ACCESS_KEY AWS credentials

Note: This requires the 'psql' command line tool to be installed.
    `);
    process.exit(0);
  }
  
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL not set');
    process.exit(1);
  }
  
  // Check psql is available
  try {
    await execAsync('psql --version');
  } catch {
    console.error('❌ psql command not found. Please install PostgreSQL client tools.');
    process.exit(1);
  }
  
  // Determine sources
  let configs: SourceConfig[] = [];
  
  if (values.all) {
    configs = SOURCE_CONFIGS;
  } else if (values.source) {
    const config = SOURCE_CONFIGS.find(s => s.id === values.source);
    if (!config) {
      console.error(`❌ Unknown source: ${values.source}`);
      process.exit(1);
    }
    configs = [config];
  } else {
    console.error('❌ Must specify --source=<id> or --all');
    process.exit(1);
  }
  
  console.log('========================================');
  console.log('Gold Tier COPY Loader');
  console.log('========================================');
  
  // Process each source
  const results: { source: string; success: boolean; count: number; error?: string }[] = [];
  
  for (const config of configs) {
    const result = await loadWithCopy(config);
    results.push({ source: config.id, ...result });
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  
  let successCount = 0;
  for (const r of results) {
    const status = r.success ? '✅ SUCCESS' : '❌ FAILED';
    console.log(`${r.source}: ${status} (${r.count.toLocaleString()} rows)`);
    if (r.success) successCount++;
    if (r.error) console.log(`  Error: ${r.error}`);
  }
  
  console.log('\n' + '-'.repeat(60));
  console.log(`Total: ${results.length} | Success: ${successCount}`);
  console.log('='.repeat(60));
  
  if (successCount < results.length) process.exit(1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
