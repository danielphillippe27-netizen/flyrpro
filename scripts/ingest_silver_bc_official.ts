#!/usr/bin/env tsx
/**
 * AddressBC Silver Tier Ingestion Script
 * 
 * Replaces the static StatCan ODA file for British Columbia with live
 * AddressBC data from the BC Government ArcGIS REST API.
 * 
 * The output is formatted to match ODA CSV structure so existing loaders work seamlessly.
 * 
 * Usage:
 *   export AWS_ACCESS_KEY_ID=xxx
 *   export AWS_SECRET_ACCESS_KEY=xxx
 *   export AWS_REGION=us-east-1
 *   npx tsx scripts/ingest_silver_bc_official.ts
 * 
 * Data Source:
 *   - AddressBC (BC Government)
 *   - URL: https://maps.gov.bc.ca/arcgis/rest/services/province/fabricated_locations/MapServer/0
 *   - Updated: Daily
 *   - Coverage: ~2M+ addresses (includes rural fire lanes, indigenous lands)
 * 
 * Output:
 *   - s3://silver-standard-addresses-canada/silver/ca/bc/addresses.csv
 *   - Format: CSV matching ODA structure
 */

import axios from 'axios';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable, PassThrough } from 'stream';

// ============================================================================
// CONFIGURATION
// ============================================================================

const BUCKET_NAME = process.env.AWS_BUCKET_NAME || 'silver-standard-addresses-canada';
const AWS_REGION = process.env.AWS_REGION || 'us-east-2';
const S3_KEY = 'silver/ca/bc/addresses.csv';

const ARCGIS_URL = 'https://maps.gov.bc.ca/arcgis/rest/services/province/fabricated_locations/MapServer/0/query';
const PAGE_SIZE = 2000; // ArcGIS max is typically 2000
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

// ODA CSV Headers (target format)
const CSV_HEADERS = [
  'latitude',
  'longitude', 
  'street_number',
  'street_name',
  'unit',
  'city',
  'province',
  'postal_code',
  // Additional metadata fields from AddressBC
  'full_address',
  'site_id',
  'location_descriptor',
  'is_primary',
];

// ============================================================================
// S3 CLIENT
// ============================================================================

const s3Client = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// ============================================================================
// TYPES
// ============================================================================

interface AddressBCFeature {
  attributes: {
    civic_number?: string | number;
    street_name?: string;
    unit?: string;
    locality_name?: string;
    site_postal_code?: string;
    full_address?: string;
    site_id?: string | number;
    location_descriptor?: string;
    is_primary?: string | boolean;
    [key: string]: any;
  };
  geometry: {
    x: number; // longitude
    y: number; // latitude
  };
}

interface AddressBCResponse {
  features: AddressBCFeature[];
  exceededTransferLimit?: boolean;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Escape CSV field value
 */
function escapeCsv(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '';
  const str = String(value);
  // Escape quotes and wrap in quotes if contains comma, quote, or newline
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Convert AddressBC feature to CSV row
 */
function featureToCsvRow(feature: AddressBCFeature): string {
  const attrs = feature.attributes;
  const geom = feature.geometry;
  
  const values = [
    geom?.y ?? '',           // latitude
    geom?.x ?? '',           // longitude
    attrs?.civic_number ?? '', // street_number
    attrs?.street_name ?? '',  // street_name
    attrs?.unit ?? '',         // unit
    attrs?.locality_name ?? '', // city
    'BC',                      // province (hardcoded)
    attrs?.site_postal_code ?? '', // postal_code
    attrs?.full_address ?? '',     // full_address
    attrs?.site_id ?? '',          // site_id
    attrs?.location_descriptor ?? '', // location_descriptor
    attrs?.is_primary ?? '',       // is_primary
  ];
  
  return values.map(escapeCsv).join(',');
}

// ============================================================================
// API FETCHING WITH RETRY
// ============================================================================

async function fetchPage(offset: number, retryCount = 0): Promise<AddressBCResponse> {
  const params = {
    where: '1=1',
    outFields: '*',
    f: 'json',
    resultOffset: offset,
    resultRecordCount: PAGE_SIZE,
    returnGeometry: true,
  };

  try {
    const response = await axios.get(ARCGIS_URL, {
      params,
      timeout: 60000,
      headers: {
        'Accept': 'application/json',
      },
    });

    return response.data;
  } catch (error: any) {
    if (retryCount < MAX_RETRIES) {
      console.warn(`    ⚠️  Page at offset ${offset} failed, retrying (${retryCount + 1}/${MAX_RETRIES})...`);
      await sleep(RETRY_DELAY_MS * (retryCount + 1)); // Exponential backoff
      return fetchPage(offset, retryCount + 1);
    }
    throw error;
  }
}

// ============================================================================
// MAIN INGESTION
// ============================================================================

async function ingestAddressBC(): Promise<void> {
  console.log('========================================');
  console.log('AddressBC Silver Tier Ingestion');
  console.log('========================================');
  console.log(`Source: ${ARCGIS_URL}`);
  console.log(`Target: s3://${BUCKET_NAME}/${S3_KEY}`);
  console.log(`Page Size: ${PAGE_SIZE} records`);
  console.log('');

  const startTime = Date.now();
  let totalRecords = 0;
  let offset = 0;
  let hasMore = true;
  let pageCount = 0;

  // Create a PassThrough stream for piping to S3
  const passThrough = new PassThrough();
  
  // Set up S3 upload
  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: BUCKET_NAME,
      Key: S3_KEY,
      Body: passThrough,
      ContentType: 'text/csv',
      Metadata: {
        'region': 'bc',
        'region-name': 'British Columbia',
        'source': 'AddressBC',
        'source-url': ARCGIS_URL,
        'source-type': 'arcgis-rest-api',
        'ingestion-date': new Date().toISOString(),
      },
    },
    partSize: 5 * 1024 * 1024, // 5MB parts
    leavePartsOnError: false,
  });

  // Track upload progress
  let uploadedBytes = 0;
  upload.on('httpUploadProgress', (progress) => {
    if (progress.loaded) {
      uploadedBytes = progress.loaded;
    }
  });

  // Write CSV header
  passThrough.write(CSV_HEADERS.join(',') + '\n');

  console.log('📥 Fetching data from AddressBC API...\n');

  try {
    while (hasMore) {
      pageCount++;
      process.stdout.write(`\r  Page ${pageCount} | Offset: ${offset.toLocaleString()} | Records: ${totalRecords.toLocaleString()} | Uploaded: ${formatBytes(uploadedBytes)}`);

      const data = await fetchPage(offset);
      
      if (!data.features || data.features.length === 0) {
        hasMore = false;
        break;
      }

      // Convert features to CSV rows and write to stream
      for (const feature of data.features) {
        const row = featureToCsvRow(feature);
        passThrough.write(row + '\n');
      }

      totalRecords += data.features.length;
      
      // Check if there are more records
      hasMore = data.exceededTransferLimit === true || data.features.length === PAGE_SIZE;
      
      if (hasMore) {
        offset += PAGE_SIZE;
        // Small delay to be nice to the API
        await sleep(100);
      }
    }

    process.stdout.write('\n');
    console.log(`\n✓ Fetched ${totalRecords.toLocaleString()} records in ${pageCount} pages`);

    // Close the stream
    passThrough.end();

    // Wait for upload to complete
    console.log('\n☁️  Finalizing S3 upload...');
    const uploadResult = await upload.done();
    
    const duration = Date.now() - startTime;
    
    console.log(`\n✅ AddressBC Ingestion - SUCCESS`);
    console.log(`   Duration: ${formatDuration(duration)}`);
    console.log(`   Records: ${totalRecords.toLocaleString()}`);
    console.log(`   Pages: ${pageCount}`);
    console.log(`   S3 Size: ${formatBytes(uploadedBytes)}`);
    console.log(`   ETag: ${uploadResult.ETag}`);
    console.log(`   URL: https://${BUCKET_NAME}.s3.amazonaws.com/${S3_KEY}`);

  } catch (error: any) {
    passThrough.destroy();
    console.error(`\n\n❌ Ingestion FAILED`);
    console.error(`   Error: ${error.message}`);
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Data:`, error.response.data);
    }
    throw error;
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  // Validate environment
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('❌ Error: AWS credentials not found');
    console.error('   Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY');
    process.exit(1);
  }

  try {
    await ingestAddressBC();
  } catch (error) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
