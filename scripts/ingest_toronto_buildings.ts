#!/usr/bin/env tsx
/**
 * Toronto 3D Massing Building Footprints + Address Points Ingestion Script
 * 
 * Fetches Toronto building footprints and address points from CKAN Open Data Portal,
 * converts/transforms them, and uploads to S3.
 * 
 * Toronto provides building data as Shapefile ZIP and address data as GeoJSON.
 * 
 * Usage:
 *   npx tsx scripts/ingest_toronto_buildings.ts [--dry-run] [--buildings-only] [--addresses-only]
 */

import axios from 'axios';
import AdmZip from 'adm-zip';
import * as mapshaper from 'mapshaper';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as JSONStream from 'jsonstream';

// ============================================================================
// Load environment variables from .env.local in project root
// ============================================================================
const envPath = path.resolve(__dirname, '..', '.env.local');
dotenv.config({ path: envPath });

// ============================================================================
// CONFIGURATION
// ============================================================================

const S3_BUCKET = process.env.FLYR_ADDRESSES_S3_BUCKET || process.env.AWS_BUCKET_NAME || 'flyr-pro-addresses-2025';
const S3_REGION = process.env.FLYR_ADDRESSES_S3_REGION || process.env.AWS_REGION || 'us-east-2';
const S3_BUILDINGS_KEY = 'gold-standard/canada/ontario/toronto/buildings.geojson';
const S3_ADDRESSES_KEY = 'gold-standard/canada/ontario/toronto/addresses.geojson';

const CKAN_BUILDINGS_URL = 'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=3d-massing';
const CKAN_ADDRESSES_URL = 'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=address-points-municipal-toronto-one-address-repository';

// Minimum building area in sqm (filter out sheds)
const MIN_AREA = 35;

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
// TYPES
// ============================================================================

interface CKANResource {
  id: string;
  name: string;
  format: string;
  url: string;
  last_modified?: string;
  created?: string;
}

interface CKANPackageResponse {
  success: boolean;
  result: {
    id: string;
    name: string;
    title: string;
    resources: CKANResource[];
  };
}

interface AddressProperties {
  ADDRESS_POINT_ID?: string | number;
  LO_NUM?: string | number;
  LO_NUM_SUF?: string;
  LFN_NAME?: string;
  SUITE?: string;
  // Alternative field names (source might vary)
  HI_NUM?: string | number;
  LF_NAME?: string;
  UNIT?: string;
  APT?: string;
  FLR?: string;
}

interface AddressFeature {
  type: 'Feature';
  properties: AddressProperties;
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
}

interface TransformedAddress {
  type: 'Feature';
  properties: {
    street_number: string;
    street_name: string;
    unit: string;
    city: string;
    province: string;
    country: string;
    source_id: string | number;
  };
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
}

// ============================================================================
// STEP A: FIND DOWNLOAD LINKS
// ============================================================================

async function findBuildingsDownloadLink(): Promise<{ url: string; name: string }> {
  console.log('\n📦 Fetching building data from Toronto CKAN API...');
  console.log(`   URL: ${CKAN_BUILDINGS_URL}`);
  
  try {
    const response = await axios.get<CKANPackageResponse>(CKAN_BUILDINGS_URL, {
      timeout: 30000,
      headers: { Accept: 'application/json' },
    });
    
    if (!response.data.success) {
      throw new Error('CKAN API returned unsuccessful response');
    }
    
    const resources = response.data.result.resources;
    console.log(`   Found ${resources.length} resources`);
    
    const targetResource = resources.find(r => {
      const name = r.name || '';
      const format = (r.format || '').toUpperCase();
      return (
        name.includes('3D Massing') &&
        name.includes('WGS84') &&
        format === 'SHP' &&
        !name.includes('Multipatch')
      );
    });
    
    if (!targetResource) {
      console.log('   Available resources:');
      resources.forEach(r => {
        console.log(`     - ${r.name} (${r.format})`);
      });
      throw new Error('Could not find 3D Massing (WGS84) SHP resource');
    }
    
    console.log(`   ✓ Found resource: ${targetResource.name}`);
    
    return {
      url: targetResource.url,
      name: targetResource.name,
    };
    
  } catch (error: any) {
    console.error('   ✗ Failed to fetch CKAN package:', error.message);
    throw error;
  }
}

async function findAddressesDownloadLink(): Promise<{ url: string; name: string }> {
  console.log('\n📦 Fetching address data from Toronto CKAN API...');
  console.log(`   URL: ${CKAN_ADDRESSES_URL}`);
  
  try {
    const response = await axios.get<CKANPackageResponse>(CKAN_ADDRESSES_URL, {
      timeout: 30000,
      headers: { Accept: 'application/json' },
    });
    
    if (!response.data.success) {
      throw new Error('CKAN API returned unsuccessful response');
    }
    
    const resources = response.data.result.resources;
    console.log(`   Found ${resources.length} resources`);
    
    // Find GeoJSON resource - specifically WGS84 (4326) format
    // The datastore dump URL (first resource) returns CSV not GeoJSON
    // We need to find the actual .geojson file
    const targetResource = resources.find(r => {
      const name = (r.name || '').toLowerCase();
      const format = (r.format || '').toUpperCase();
      // Look for WGS84/4326 GeoJSON specifically
      return format === 'GEOJSON' && name.includes('4326');
    });
    
    if (!targetResource) {
      console.log('   Available resources:');
      resources.forEach(r => {
        console.log(`     - ${r.name} (${r.format})`);
      });
      throw new Error('Could not find GeoJSON resource for addresses');
    }
    
    console.log(`   ✓ Found resource: ${targetResource.name}`);
    
    return {
      url: targetResource.url,
      name: targetResource.name,
    };
    
  } catch (error: any) {
    console.error('   ✗ Failed to fetch CKAN package:', error.message);
    throw error;
  }
}

// ============================================================================
// STEP B: DOWNLOAD & PROCESS BUILDINGS (Shapefile)
// ============================================================================

async function downloadAndUnzipBuildings(url: string): Promise<{ shpPath: string }> {
  console.log('\n📥 Downloading building Shapefile ZIP...');
  console.log(`   URL: ${url}`);
  
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toronto-buildings-'));
  
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 120000,
      headers: {
        'User-Agent': 'FLYR-Pro-Data-Ingestion/1.0',
      },
    });
    
    const zipBuffer = Buffer.from(response.data);
    console.log(`   Downloaded: ${(zipBuffer.length / 1024 / 1024).toFixed(2)} MB`);
    
    const zip = new AdmZip(zipBuffer);
    const zipEntries = zip.getEntries();
    
    let shpPath: string | null = null;
    
    for (const entry of zipEntries) {
      const entryName = entry.entryName.toLowerCase();
      
      if (entryName.startsWith('__macosx') || entryName.endsWith('/')) {
        continue;
      }
      
      const extractPath = path.join(tempDir, entry.entryName);
      zip.extractEntryTo(entry, tempDir, true, true);
      
      if (entryName.endsWith('.shp')) {
        shpPath = extractPath;
      }
    }
    
    if (!shpPath) {
      throw new Error('No .shp file found in ZIP archive');
    }
    
    console.log(`   ✓ Shapefile extracted: ${path.basename(shpPath)}`);
    
    return { shpPath };
    
  } catch (error: any) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

async function convertBuildingsToGeoJSON(shpPath: string): Promise<any> {
  console.log('\n🔄 Converting Shapefile to GeoJSON...');
  
  return new Promise((resolve, reject) => {
    const outputPath = shpPath.replace('.shp', '.geojson');
    
    const commands = [
      `-i "${shpPath}"`,
      `-o "${outputPath}" format=geojson`,
    ];
    
    mapshaper.runCommands(commands.join(' '), (err: any) => {
      if (err) {
        reject(new Error(`Mapshaper conversion failed: ${err.message}`));
        return;
      }
      
      try {
        const geojsonContent = fs.readFileSync(outputPath, 'utf-8');
        const geojson = JSON.parse(geojsonContent);
        
        console.log(`   ✓ Converted: ${geojson.features?.length || 0} features`);
        
        fs.unlinkSync(outputPath);
        resolve(geojson);
      } catch (parseErr: any) {
        reject(new Error(`Failed to parse GeoJSON: ${parseErr.message}`));
      }
    });
  });
}

function filterBuildings(geojson: any): any {
  if (!geojson.features || !Array.isArray(geojson.features)) {
    return geojson;
  }
  
  console.log(`\n🔍 Filtering buildings (min area: ${MIN_AREA} sqm)...`);
  
  const originalCount = geojson.features.length;
  
  const filtered = geojson.features.filter((f: any) => {
    const area = f.properties?.SHAPE_Area || f.properties?.area || f.properties?.Shape_Area;
    if (!area) return true;
    return parseFloat(area) >= MIN_AREA;
  });
  
  const removedCount = originalCount - filtered.length;
  console.log(`   Filtered out ${removedCount} buildings < ${MIN_AREA} sqm`);
  console.log(`   Final count: ${filtered.length} buildings`);
  
  return {
    ...geojson,
    features: filtered,
  };
}

// ============================================================================
// STEP C: DOWNLOAD & PROCESS ADDRESSES (GeoJSON with streaming)
// ============================================================================

function transformAddressFeature(feature: AddressFeature): TransformedAddress | null {
  const props = feature.properties || {};
  
  // Extract street number from various possible field names
  let streetNumber = '';
  if (props.LO_NUM !== undefined) {
    streetNumber = String(props.LO_NUM);
    if (props.LO_NUM_SUF) {
      streetNumber += props.LO_NUM_SUF;
    }
  } else if (props.HI_NUM !== undefined) {
    streetNumber = String(props.HI_NUM);
  }
  
  // Extract street name from various possible field names
  let streetName = '';
  if (props.LFN_NAME) {
    streetName = String(props.LFN_NAME);
  } else if (props.LF_NAME) {
    streetName = String(props.LF_NAME);
  }
  
  // Extract unit/apt/suite from various possible field names
  let unit = '';
  if (props.SUITE) {
    unit = String(props.SUITE);
  } else if (props.UNIT) {
    unit = String(props.UNIT);
  } else if (props.APT) {
    unit = String(props.APT);
  }
  
  // Get source ID
  const sourceId = props.ADDRESS_POINT_ID || '';
  
  // Skip if we don't have minimum required fields
  if (!streetNumber && !streetName) {
    return null;
  }
  
  return {
    type: 'Feature',
    properties: {
      street_number: streetNumber,
      street_name: streetName,
      unit: unit,
      city: 'Toronto',
      province: 'Ontario',
      country: 'Canada',
      source_id: sourceId,
    },
    geometry: feature.geometry,
  };
}

async function downloadAndTransformAddresses(url: string): Promise<{ 
  features: TransformedAddress[]; 
  count: number; 
  skipped: number;
}> {
  console.log('\n📥 Downloading and transforming addresses...');
  console.log(`   URL: ${url}`);
  
  const tempFile = path.join(os.tmpdir(), `toronto-addresses-${Date.now()}.geojson`);
  
  try {
    // Download with streaming for large files
    console.log('   Downloading (streaming)...');
    const response = await axios.get(url, {
      responseType: 'stream',
      timeout: 300000, // 5 minutes for large file
      headers: {
        'User-Agent': 'FLYR-Pro-Data-Ingestion/1.0',
      },
    });
    
    const writer = fs.createWriteStream(tempFile);
    response.data.pipe(writer);
    
    await new Promise<void>((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    
    const stats = fs.statSync(tempFile);
    console.log(`   Downloaded: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    
    // Stream-process the GeoJSON
    console.log('   Transforming features...');
    
    const features: TransformedAddress[] = [];
    let count = 0;
    let skipped = 0;
    
    await new Promise<void>((resolve, reject) => {
      const stream = fs.createReadStream(tempFile);
      const parser = JSONStream.parse('features.*');
      
      parser.on('data', (feature: AddressFeature) => {
        count++;
        
        if (count % 50000 === 0) {
          console.log(`     Processed ${count.toLocaleString()} features...`);
        }
        
        const transformed = transformAddressFeature(feature);
        if (transformed) {
          features.push(transformed);
        } else {
          skipped++;
        }
      });
      
      parser.on('end', () => {
        console.log(`   ✓ Transformed: ${features.length.toLocaleString()} addresses`);
        if (skipped > 0) {
          console.log(`   ⚠ Skipped: ${skipped.toLocaleString()} (missing required fields)`);
        }
        resolve();
      });
      
      parser.on('error', (err: Error) => {
        reject(new Error(`JSON parsing failed: ${err.message}`));
      });
      
      stream.pipe(parser);
    });
    
    return { features, count, skipped };
    
  } finally {
    // Cleanup temp file
    try {
      fs.unlinkSync(tempFile);
    } catch {}
  }
}

// ============================================================================
// STEP D: UPLOAD TO S3
// ============================================================================

async function uploadBuildingsToS3(geojson: any, dryRun: boolean): Promise<boolean> {
  const enrichedGeoJSON = {
    ...geojson,
    metadata: {
      source: 'City of Toronto 3D Massing',
      source_url: 'https://open.toronto.ca/dataset/3d-massing/',
      s3_key: S3_BUILDINGS_KEY,
      fetched_at: new Date().toISOString(),
      feature_count: geojson.features?.length || 0,
      min_area_filter: MIN_AREA,
    },
  };
  
  const jsonString = JSON.stringify(enrichedGeoJSON);
  const sizeMB = (jsonString.length / 1024 / 1024).toFixed(2);
  
  console.log(`\n☁️  Uploading buildings to S3:`);
  console.log(`   Bucket: ${S3_BUCKET}`);
  console.log(`   Key: ${S3_BUILDINGS_KEY}`);
  console.log(`   Size: ${sizeMB} MB`);
  
  if (dryRun) {
    console.log('   [DRY RUN] Skipping upload');
    return true;
  }
  
  try {
    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: S3_BUILDINGS_KEY,
      Body: jsonString,
      ContentType: 'application/geo+json',
      Metadata: {
        'source': 'toronto-3d-massing',
        'fetched-at': new Date().toISOString(),
        'feature-count': String(geojson.features?.length || 0),
      },
    });
    
    await s3Client.send(command);
    console.log('   ✓ Upload successful');
    return true;
    
  } catch (error: any) {
    console.error('   ✗ Upload failed:', error.message);
    return false;
  }
}

async function uploadAddressesToS3(
  features: TransformedAddress[], 
  dryRun: boolean
): Promise<boolean> {
  const geojson = {
    type: 'FeatureCollection',
    features,
    metadata: {
      source: 'City of Toronto One Address Repository',
      source_url: 'https://open.toronto.ca/dataset/address-points-municipal-toronto-one-address-repository/',
      s3_key: S3_ADDRESSES_KEY,
      fetched_at: new Date().toISOString(),
      feature_count: features.length,
      fields_mapped: {
        street_number: 'LO_NUM + LO_NUM_SUF (or HI_NUM)',
        street_name: 'LFN_NAME (or LF_NAME)',
        unit: 'SUITE (or UNIT/APT)',
        city: 'Hardcoded: "Toronto"',
        province: 'Hardcoded: "Ontario"',
        country: 'Hardcoded: "Canada"',
      },
    },
  };
  
  const jsonString = JSON.stringify(geojson);
  const sizeMB = (jsonString.length / 1024 / 1024).toFixed(2);
  
  console.log(`\n☁️  Uploading addresses to S3:`);
  console.log(`   Bucket: ${S3_BUCKET}`);
  console.log(`   Key: ${S3_ADDRESSES_KEY}`);
  console.log(`   Size: ${sizeMB} MB`);
  
  if (dryRun) {
    console.log('   [DRY RUN] Skipping upload');
    return true;
  }
  
  try {
    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: S3_ADDRESSES_KEY,
      Body: jsonString,
      ContentType: 'application/geo+json',
      Metadata: {
        'source': 'toronto-one-address-repository',
        'fetched-at': new Date().toISOString(),
        'feature-count': String(features.length),
      },
    });
    
    await s3Client.send(command);
    console.log('   ✓ Upload successful');
    return true;
    
  } catch (error: any) {
    console.error('   ✗ Upload failed:', error.message);
    return false;
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const buildingsOnly = process.argv.includes('--buildings-only');
  const addressesOnly = process.argv.includes('--addresses-only');
  
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     Toronto 3D Massing + Address Points Ingestion          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Tasks: ${buildingsOnly ? 'Buildings only' : addressesOnly ? 'Addresses only' : 'Both buildings and addresses'}`);
  console.log('');
  
  // Validate AWS credentials
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('❌ Error: AWS credentials not found in environment');
    process.exit(1);
  }
  
  const results = {
    buildings: { success: false, count: 0 },
    addresses: { success: false, count: 0 },
  };
  
  let tempDir: string | null = null;
  
  try {
    // =======================================================================
    // INGEST BUILDINGS
    // =======================================================================
    if (!addressesOnly) {
      console.log('\n' + '═'.repeat(60));
      console.log('🏢 BUILDING FOOTPRINTS');
      console.log('═'.repeat(60));
      
      const { url, name } = await findBuildingsDownloadLink();
      const { shpPath } = await downloadAndUnzipBuildings(url);
      tempDir = path.dirname(shpPath);
      
      let geojson = await convertBuildingsToGeoJSON(shpPath);
      geojson = filterBuildings(geojson);
      
      results.buildings.success = await uploadBuildingsToS3(geojson, dryRun);
      results.buildings.count = geojson.features?.length || 0;
    }
    
    // =======================================================================
    // INGEST ADDRESSES
    // =======================================================================
    if (!buildingsOnly) {
      console.log('\n' + '═'.repeat(60));
      console.log('📍 ADDRESS POINTS');
      console.log('═'.repeat(60));
      
      const { url, name } = await findAddressesDownloadLink();
      const { features, count, skipped } = await downloadAndTransformAddresses(url);
      
      results.addresses.success = await uploadAddressesToS3(features, dryRun);
      results.addresses.count = features.length;
    }
    
    // =======================================================================
    // SUMMARY
    // =======================================================================
    console.log('\n' + '═'.repeat(60));
    console.log('📊 SUMMARY');
    console.log('═'.repeat(60));
    
    if (!addressesOnly) {
      console.log(`Buildings:`);
      console.log(`  Features: ${results.buildings.count.toLocaleString()}`);
      console.log(`  S3 Key: ${S3_BUILDINGS_KEY}`);
      console.log(`  Status: ${results.buildings.success ? '✅ SUCCESS' : '❌ FAILED'}`);
    }
    
    if (!buildingsOnly) {
      console.log(`Addresses:`);
      console.log(`  Features: ${results.addresses.count.toLocaleString()}`);
      console.log(`  S3 Key: ${S3_ADDRESSES_KEY}`);
      console.log(`  Status: ${results.addresses.success ? '✅ SUCCESS' : '❌ FAILED'}`);
    }
    
    console.log('═'.repeat(60));
    
    // Exit with error if any required task failed
    const allSuccess = (addressesOnly || results.buildings.success) && 
                       (buildingsOnly || results.addresses.success);
    
    if (!allSuccess) {
      process.exit(1);
    }
    
  } catch (error: any) {
    console.error('\n❌ Ingestion failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (tempDir) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
        console.log('\n🧹 Cleaned up temp directory');
      } catch {}
    }
  }
}

main();
