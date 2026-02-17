#!/usr/bin/env tsx
/**
 * Toronto 3D Massing Building Footprints Ingestion Script
 * 
 * Fetches Toronto building footprints from CKAN Open Data Portal,
 * converts Shapefile to GeoJSON, and uploads to S3.
 * 
 * Toronto provides this as a Shapefile ZIP, not an ArcGIS API.
 * 
 * Usage:
 *   npx tsx scripts/ingest_toronto_buildings.ts [--dry-run]
 */

import axios from 'axios';
import AdmZip from 'adm-zip';
import * as mapshaper from 'mapshaper';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

dotenv.config({ path: '.env.local' });

// ============================================================================
// CONFIGURATION
// ============================================================================

const S3_BUCKET = process.env.AWS_BUCKET_NAME || 'flyr-pro-addresses-2025';
const S3_REGION = process.env.AWS_REGION || 'us-east-1';
const S3_KEY = 'gold/ca/on/toronto/buildings.geojson';

const CKAN_API_URL = 'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=3d-massing';

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

// ============================================================================
// STEP A: FIND THE DOWNLOAD LINK
// ============================================================================

async function findDownloadLink(): Promise<{ url: string; name: string }> {
  console.log('Fetching package info from Toronto CKAN API...');
  console.log(`  URL: ${CKAN_API_URL}`);
  
  try {
    const response = await axios.get<CKANPackageResponse>(CKAN_API_URL, {
      timeout: 30000,
      headers: { Accept: 'application/json' },
    });
    
    if (!response.data.success) {
      throw new Error('CKAN API returned unsuccessful response');
    }
    
    const resources = response.data.result.resources;
    console.log(`  Found ${resources.length} resources`);
    
    // Find the specific resource:
    // - name contains "3D Massing (WGS84)"
    // - format is "SHP"
    // - name does NOT contain "Multipatch"
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
      console.log('Available resources:');
      resources.forEach(r => {
        console.log(`  - ${r.name} (${r.format})`);
      });
      throw new Error('Could not find 3D Massing (WGS84) SHP resource');
    }
    
    console.log(`✓ Found resource: ${targetResource.name}`);
    console.log(`  Download URL: ${targetResource.url}`);
    
    return {
      url: targetResource.url,
      name: targetResource.name,
    };
    
  } catch (error: any) {
    console.error('Failed to fetch CKAN package:', error.message);
    throw error;
  }
}

// ============================================================================
// STEP B: DOWNLOAD & UNZIP
// ============================================================================

async function downloadAndUnzip(url: string): Promise<{ shpPath: string; shxPath?: string; dbfPath?: string }> {
  console.log('\nDownloading Shapefile ZIP...');
  console.log(`  URL: ${url}`);
  
  // Create temp directory
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toronto-massing-'));
  console.log(`  Temp dir: ${tempDir}`);
  
  try {
    // Download the ZIP file
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 120000, // 2 minutes for large file
      headers: {
        'User-Agent': 'FLYR-Pro-Data-Ingestion/1.0',
      },
    });
    
    const zipBuffer = Buffer.from(response.data);
    console.log(`  Downloaded: ${(zipBuffer.length / 1024 / 1024).toFixed(2)} MB`);
    
    // Unzip
    const zip = new AdmZip(zipBuffer);
    const zipEntries = zip.getEntries();
    
    console.log(`  ZIP entries: ${zipEntries.length}`);
    
    let shpPath: string | null = null;
    let shxPath: string | null = null;
    let dbfPath: string | null = null;
    
    for (const entry of zipEntries) {
      const entryName = entry.entryName.toLowerCase();
      
      // Skip macOS metadata and directories
      if (entryName.startsWith('__macosx') || entryName.endsWith('/')) {
        continue;
      }
      
      // Extract to temp directory
      const extractPath = path.join(tempDir, entry.entryName);
      zip.extractEntryTo(entry, tempDir, true, true);
      
      console.log(`    Extracted: ${entry.entryName}`);
      
      // Track the files we need
      if (entryName.endsWith('.shp')) {
        shpPath = extractPath;
      } else if (entryName.endsWith('.shx')) {
        shxPath = extractPath;
      } else if (entryName.endsWith('.dbf')) {
        dbfPath = extractPath;
      }
    }
    
    if (!shpPath) {
      throw new Error('No .shp file found in ZIP archive');
    }
    
    console.log(`✓ Shapefile extracted: ${path.basename(shpPath)}`);
    
    return {
      shpPath,
      shxPath: shxPath || undefined,
      dbfPath: dbfPath || undefined,
    };
    
  } catch (error: any) {
    // Cleanup on error
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    throw error;
  }
}

// ============================================================================
// STEP C: CONVERT TO GEOJSON
// ============================================================================

async function convertToGeoJSON(shpPath: string): Promise<any> {
  console.log('\nConverting Shapefile to GeoJSON...');
  console.log(`  Input: ${shpPath}`);
  
  return new Promise((resolve, reject) => {
    // Use mapshaper to convert
    // Command: -i input.shp -filter 'this.properties.area >= 35' -o format=geojson output.json
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
        
        console.log(`✓ Converted: ${geojson.features?.length || 0} features`);
        
        // Cleanup temp files
        try {
          fs.unlinkSync(outputPath);
        } catch {}
        
        resolve(geojson);
      } catch (parseErr: any) {
        reject(new Error(`Failed to parse GeoJSON: ${parseErr.message}`));
      }
    });
  });
}

/**
 * Filter buildings by area
 */
function filterBuildings(geojson: any): any {
  if (!geojson.features || !Array.isArray(geojson.features)) {
    return geojson;
  }
  
  console.log(`\nFiltering buildings (min area: ${MIN_AREA} sqm)...`);
  
  const originalCount = geojson.features.length;
  
  // Filter features with area >= MIN_AREA
  // Toronto 3D Massing has SHAPE_Area field
  const filtered = geojson.features.filter((f: any) => {
    const area = f.properties?.SHAPE_Area || f.properties?.area || f.properties?.Shape_Area;
    if (!area) return true; // Keep if no area field
    return parseFloat(area) >= MIN_AREA;
  });
  
  const removedCount = originalCount - filtered.length;
  console.log(`  Filtered out ${removedCount} buildings < ${MIN_AREA} sqm`);
  console.log(`  Final count: ${filtered.length} buildings`);
  
  return {
    ...geojson,
    features: filtered,
  };
}

// ============================================================================
// STEP D: UPLOAD TO S3
// ============================================================================

async function uploadToS3(geojson: any, dryRun: boolean): Promise<boolean> {
  const enrichedGeoJSON = {
    ...geojson,
    metadata: {
      source: 'City of Toronto 3D Massing',
      source_url: 'https://open.toronto.ca/dataset/3d-massing/',
      s3_key: S3_KEY,
      fetched_at: new Date().toISOString(),
      feature_count: geojson.features?.length || 0,
      min_area_filter: MIN_AREA,
    },
  };
  
  const jsonString = JSON.stringify(enrichedGeoJSON);
  const sizeMB = (jsonString.length / 1024 / 1024).toFixed(2);
  
  console.log(`\nUploading to S3:`);
  console.log(`  Bucket: ${S3_BUCKET}`);
  console.log(`  Key: ${S3_KEY}`);
  console.log(`  Size: ${sizeMB} MB`);
  
  if (dryRun) {
    console.log('  [DRY RUN] Skipping upload');
    return true;
  }
  
  try {
    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: S3_KEY,
      Body: jsonString,
      ContentType: 'application/geo+json',
      Metadata: {
        'source': 'toronto-3d-massing',
        'fetched-at': new Date().toISOString(),
        'feature-count': String(geojson.features?.length || 0),
      },
    });
    
    await s3Client.send(command);
    console.log('  ✓ Upload successful');
    return true;
    
  } catch (error: any) {
    console.error('  ✗ Upload failed:', error.message);
    return false;
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  
  console.log('========================================');
  console.log('Toronto 3D Massing Ingest');
  console.log('========================================');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log('');
  
  // Validate AWS credentials
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('Error: AWS credentials not found');
    process.exit(1);
  }
  
  let tempDir: string | null = null;
  
  try {
    // Step A: Find download link
    const { url, name } = await findDownloadLink();
    
    // Step B: Download & Unzip
    const { shpPath } = await downloadAndUnzip(url);
    tempDir = path.dirname(shpPath);
    
    // Step C: Convert to GeoJSON
    let geojson = await convertToGeoJSON(shpPath);
    
    // Filter buildings
    geojson = filterBuildings(geojson);
    
    // Step D: Upload to S3
    const uploaded = await uploadToS3(geojson, dryRun);
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`Resource: ${name}`);
    console.log(`Features: ${geojson.features?.length?.toLocaleString() || 0}`);
    console.log(`S3 Key: ${S3_KEY}`);
    console.log(`Status: ${uploaded ? '✅ SUCCESS' : '❌ FAILED'}`);
    console.log('='.repeat(60));
    
    if (!uploaded) {
      process.exit(1);
    }
    
  } catch (error: any) {
    console.error('\n❌ Ingestion failed:', error.message);
    process.exit(1);
  } finally {
    // Cleanup temp directory
    if (tempDir) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
        console.log(`\nCleaned up temp directory`);
      } catch {}
    }
  }
}

main();
