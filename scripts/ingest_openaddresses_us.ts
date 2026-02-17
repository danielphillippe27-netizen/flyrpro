#!/usr/bin/env tsx
/**
 * OpenAddresses US Data Ingestion Script
 * 
 * Downloads the 4 regional bundles from OpenAddresses and extracts only the
 * statewide.csv files, uploading them to S3 in a state-organized structure.
 * 
 * Regional Bundles:
 *   - us-northeast.zip (ME, NH, VT, MA, RI, CT, NY, NJ, PA)
 *   - us-south.zip (DE, MD, DC, VA, WV, KY, TN, NC, SC, GA, FL, AL, MS, AR, LA, OK, TX)
 *   - us-midwest.zip (OH, MI, IN, WI, IL, MN, IA, MO, ND, SD, NE, KS)
 *   - us-west.zip (MT, ID, WY, NV, UT, CO, AZ, NM, WA, OR, CA, AK, HI)
 * 
 * S3 Output Structure:
 *   s3://{bucket}/silver/us/{state_code}/addresses.csv
 *   Example: s3://flyr-pro-data/silver/us/ny/addresses.csv
 * 
 * Usage:
 *   export AWS_ACCESS_KEY_ID=xxx
 *   export AWS_SECRET_ACCESS_KEY=xxx
 *   export AWS_REGION=us-east-1
 *   export AWS_BUCKET_NAME=flyr-pro-data
 *   npx tsx scripts/ingest_openaddresses_us.ts
 * 
 * Optional: Process specific regions only:
 *   npx tsx scripts/ingest_openaddresses_us.ts northeast west
 * 
 * Optional: Dry run (show what would be processed without uploading):
 *   npx tsx scripts/ingest_openaddresses_us.ts --dry-run
 * 
 * Data Source:
 *   - https://www.openaddresses.io/
 *   - http://results.openaddresses.io/index.json (for available bundles)
 */

import axios, { AxiosResponse } from 'axios';
import JSZip from 'jszip';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';

// ============================================================================
// CONFIGURATION
// ============================================================================

const BUCKET_NAME = process.env.AWS_BUCKET_NAME || 'flyr-pro-addresses-2025';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const BASE_URL = 'https://data.openaddresses.io';

interface RegionalBundle {
  name: string;           // e.g., 'northeast'
  url: string;            // Download URL
  s3Prefix: string;       // Base S3 path
  expectedStates: string[]; // Expected state codes in this bundle
  expectedSize: string;   // Human-readable expected size
}

// OpenAddresses regional bundles
// Source: http://results.openaddresses.io/index.json
const REGIONAL_BUNDLES: RegionalBundle[] = [
  {
    name: 'northeast',
    url: `${BASE_URL}/openaddr-collected-us_northeast.zip`,
    s3Prefix: 'silver/us',
    expectedStates: ['me', 'nh', 'vt', 'ma', 'ri', 'ct', 'ny', 'nj', 'pa'],
    expectedSize: '~641 MB',
  },
  {
    name: 'south',
    url: `${BASE_URL}/openaddr-collected-us_south.zip`,
    s3Prefix: 'silver/us',
    expectedStates: ['de', 'md', 'dc', 'va', 'wv', 'ky', 'tn', 'nc', 'sc', 'ga', 'fl', 'al', 'ms', 'ar', 'la', 'ok', 'tx'],
    expectedSize: '~2.5 GB',
  },
  {
    name: 'midwest',
    url: `${BASE_URL}/openaddr-collected-us_midwest.zip`,
    s3Prefix: 'silver/us',
    expectedStates: ['oh', 'mi', 'in', 'wi', 'il', 'mn', 'ia', 'mo', 'nd', 'sd', 'ne', 'ks'],
    expectedSize: '~973 MB',
  },
  {
    name: 'west',
    url: `${BASE_URL}/openaddr-collected-us_west.zip`,
    s3Prefix: 'silver/us',
    expectedStates: ['mt', 'id', 'wy', 'nv', 'ut', 'co', 'az', 'nm', 'wa', 'or', 'ca', 'ak', 'hi'],
    expectedSize: '~1.1 GB',
  },
];

// State code to name mapping (for logging)
const STATE_NAMES: Record<string, string> = {
  me: 'Maine', nh: 'New Hampshire', vt: 'Vermont', ma: 'Massachusetts',
  ri: 'Rhode Island', ct: 'Connecticut', ny: 'New York', nj: 'New Jersey',
  pa: 'Pennsylvania', de: 'Delaware', md: 'Maryland', dc: 'District of Columbia',
  va: 'Virginia', wv: 'West Virginia', ky: 'Kentucky', tn: 'Tennessee',
  nc: 'North Carolina', sc: 'South Carolina', ga: 'Georgia', fl: 'Florida',
  al: 'Alabama', ms: 'Mississippi', ar: 'Arkansas', la: 'Louisiana',
  ok: 'Oklahoma', tx: 'Texas', oh: 'Ohio', mi: 'Michigan', in: 'Indiana',
  wi: 'Wisconsin', il: 'Illinois', mn: 'Minnesota', ia: 'Iowa', mo: 'Missouri',
  nd: 'North Dakota', sd: 'South Dakota', ne: 'Nebraska', ks: 'Kansas',
  mt: 'Montana', id: 'Idaho', wy: 'Wyoming', nv: 'Nevada', ut: 'Utah',
  co: 'Colorado', az: 'Arizona', nm: 'New Mexico', wa: 'Washington',
  or: 'Oregon', ca: 'California', ak: 'Alaska', hi: 'Hawaii',
};

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
// UTILITY FUNCTIONS
// ============================================================================

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
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

// Parse state code from OpenAddresses file path
// e.g., "us/ny/statewide.csv" -> "ny"
function parseStateCode(filePath: string): string | null {
  // OpenAddresses paths are like: "us/ny/statewide.csv" or "us/ny/county_name.csv"
  const match = filePath.match(/^us\/([a-z]{2})\//i);
  return match ? match[1].toLowerCase() : null;
}

// Check if file is a statewide file we want to keep
function isStatewideFile(filePath: string): boolean {
  const filename = filePath.split('/').pop()?.toLowerCase() || '';
  return filename === 'statewide.csv' || filename.endsWith('/statewide.csv');
}

// ============================================================================
// DOWNLOAD & PROCESS
// ============================================================================

interface StateFile {
  stateCode: string;
  filePath: string;      // Original path in ZIP
  content: Buffer;
  size: number;
}

async function downloadAndProcessBundle(
  bundle: RegionalBundle,
  dryRun: boolean
): Promise<{ success: boolean; processedStates: string[]; error?: string }> {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Processing: ${bundle.name.toUpperCase()} Region`);
  console.log(`${'='.repeat(70)}`);
  console.log(`Source URL: ${bundle.url}`);
  console.log(`Expected size: ${bundle.expectedSize}`);
  console.log(`Expected states: ${bundle.expectedStates.length} (${bundle.expectedStates.join(', ')})`);
  console.log(`S3 Destination: s3://${BUCKET_NAME}/${bundle.s3Prefix}/{state}/addresses.csv`);
  console.log('');

  const startTime = Date.now();
  const processedStates: string[] = [];

  try {
    // Step 1: Download the ZIP file with progress tracking
    console.log(`📥 Downloading ${bundle.name} bundle from OpenAddresses...`);
    console.log('   (This may take several minutes for large regions)');
    
    const response: AxiosResponse<ArrayBuffer> = await axios({
      method: 'GET',
      url: bundle.url,
      responseType: 'arraybuffer',
      timeout: 1800000, // 30 minutes timeout for very large files
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      onDownloadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          const loaded = formatBytes(progressEvent.loaded);
          const total = formatBytes(progressEvent.total);
          process.stdout.write(`\r  Progress: ${percent}% (${loaded} / ${total})`);
        } else {
          const loaded = formatBytes(progressEvent.loaded);
          process.stdout.write(`\r  Downloaded: ${loaded}`);
        }
      },
    });

    process.stdout.write('\n');
    const downloadSize = response.data.byteLength;
    console.log(`  ✓ Downloaded ${formatBytes(downloadSize)}`);

    // Step 2: Extract ZIP in memory
    console.log(`\n📦 Extracting ZIP archive...`);
    const zipStartTime = Date.now();
    
    const zip = await JSZip.loadAsync(response.data);
    const zipDuration = Date.now() - zipStartTime;
    console.log(`  ✓ ZIP loaded in ${formatDuration(zipDuration)}`);

    // Step 3: Find all statewide.csv files
    const files = Object.keys(zip.files);
    console.log(`\n📄 Files in archive: ${files.length}`);

    const statewideFiles: StateFile[] = [];

    for (const filePath of files) {
      // Skip directories and non-CSV files
      if (zip.files[filePath].dir) continue;
      if (!filePath.toLowerCase().endsWith('.csv')) continue;
      
      // Only process statewide files
      if (!isStatewideFile(filePath)) continue;

      const stateCode = parseStateCode(filePath);
      if (!stateCode) {
        console.log(`  ⚠️  Skipping file with unknown state: ${filePath}`);
        continue;
      }

      // Extract the file content
      const content = await zip.files[filePath].async('nodebuffer');
      
      statewideFiles.push({
        stateCode,
        filePath,
        content,
        size: content.length,
      });

      console.log(`  ✓ Found: ${filePath} (${formatBytes(content.length)}) -> ${stateCode}`);
    }

    console.log(`\n📊 Summary for ${bundle.name}:`);
    console.log(`  Total files in ZIP: ${files.length}`);
    console.log(`  Statewide CSV files found: ${statewideFiles.length}`);

    if (statewideFiles.length === 0) {
      console.warn(`  ⚠️  No statewide.csv files found in ${bundle.name} bundle`);
      return { success: true, processedStates: [] };
    }

    // Step 4: Upload each state file to S3
    if (!dryRun) {
      console.log(`\n☁️  Uploading state files to S3...`);
      
      for (const stateFile of statewideFiles) {
        const stateName = STATE_NAMES[stateFile.stateCode] || stateFile.stateCode.toUpperCase();
        const s3Key = `${bundle.s3Prefix}/${stateFile.stateCode}/addresses.csv`;

        console.log(`\n  📤 Uploading ${stateName} (${stateFile.stateCode.toUpperCase()})...`);
        console.log(`     Source: ${stateFile.filePath}`);
        console.log(`     Destination: s3://${BUCKET_NAME}/${s3Key}`);
        console.log(`     Size: ${formatBytes(stateFile.size)}`);

        // Estimate records from file size (rough estimate: ~100 bytes per line for OA CSV)
        const estimatedRecords = Math.floor(stateFile.size / 100);
        console.log(`     Estimated records: ~${estimatedRecords.toLocaleString()}`);

        const uploadStartTime = Date.now();

        // Create a readable stream from the buffer
        const stream = Readable.from([stateFile.content]);

        const upload = new Upload({
          client: s3Client,
          params: {
            Bucket: BUCKET_NAME,
            Key: s3Key,
            Body: stream,
            ContentType: 'text/csv',
            Metadata: {
              'state-code': stateFile.stateCode,
              'state-name': stateName,
              'source-bundle': bundle.name,
              'source-url': bundle.url,
              'original-path': stateFile.filePath,
              'source-type': 'openaddresses',
              'upload-date': new Date().toISOString(),
              'file-size-bytes': String(stateFile.size),
              'estimated-records': String(estimatedRecords),
            },
          },
          partSize: 5 * 1024 * 1024, // 5MB parts for multipart upload
          leavePartsOnError: false,
        });

        // Track upload progress
        upload.on('httpUploadProgress', (progress) => {
          if (progress.total && progress.loaded) {
            const percent = Math.round((progress.loaded * 100) / progress.total);
            process.stdout.write(`\r     Upload: ${percent}%`);
          }
        });

        const uploadResult = await upload.done();
        const uploadDuration = Date.now() - uploadStartTime;

        process.stdout.write('\n');
        console.log(`     ✓ Upload complete in ${formatDuration(uploadDuration)}`);
        console.log(`     ETag: ${uploadResult.ETag}`);

        processedStates.push(stateFile.stateCode);
      }
    } else {
      console.log(`\n🔍 DRY RUN - Would upload ${statewideFiles.length} state files:`);
      for (const stateFile of statewideFiles) {
        const stateName = STATE_NAMES[stateFile.stateCode] || stateFile.stateCode.toUpperCase();
        const s3Key = `${bundle.s3Prefix}/${stateFile.stateCode}/addresses.csv`;
        const estimatedRecords = Math.floor(stateFile.size / 100);
        
        console.log(`  - ${stateName} (${stateFile.stateCode.toUpperCase()}): ${formatBytes(stateFile.size)} (~${estimatedRecords.toLocaleString()} records) -> ${s3Key}`);
        processedStates.push(stateFile.stateCode);
      }
    }

    // Summary
    const totalDuration = Date.now() - startTime;
    console.log(`\n✅ ${bundle.name.toUpperCase()} - SUCCESS`);
    console.log(`   Total time: ${formatDuration(totalDuration)}`);
    console.log(`   States processed: ${processedStates.length}`);
    console.log(`   States: ${processedStates.map(s => s.toUpperCase()).join(', ')}`);

    return { success: true, processedStates };

  } catch (error: any) {
    console.error(`\n❌ ${bundle.name.toUpperCase()} - FAILED`);
    console.error(`   Error: ${error.message}`);
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
    }
    return { success: false, processedStates: [], error: error.message };
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('========================================');
  console.log('OpenAddresses US Data Ingestion');
  console.log('Regional Bundle Processing');
  console.log('========================================');
  console.log(`Bucket: ${BUCKET_NAME}`);
  console.log(`Region: ${AWS_REGION}`);
  console.log(`Source: https://www.openaddresses.io/`);
  console.log('');

  // Validate environment
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('❌ Error: AWS credentials not found');
    console.error('   Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY');
    process.exit(1);
  }

  // Parse command line arguments
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const regionArgs = args.filter(a => !a.startsWith('--'));

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No files will be uploaded\n');
  }

  let bundlesToProcess = REGIONAL_BUNDLES;

  if (regionArgs.length > 0) {
    const requestedRegions = regionArgs.map(a => a.toLowerCase());
    bundlesToProcess = REGIONAL_BUNDLES.filter(b => requestedRegions.includes(b.name.toLowerCase()));
    
    if (bundlesToProcess.length === 0) {
      console.error(`❌ No matching regions found for: ${regionArgs.join(', ')}`);
      console.error(`   Available: ${REGIONAL_BUNDLES.map(b => b.name).join(', ')}`);
      process.exit(1);
    }
  }

  console.log(`Processing ${bundlesToProcess.length} regional bundle(s):`);
  bundlesToProcess.forEach(b => {
    console.log(`  - ${b.name}: ${b.expectedSize} (${b.expectedStates.length} states)`);
  });
  console.log('');

  const results: { 
    bundle: RegionalBundle; 
    success: boolean; 
    processedStates: string[];
    error?: string;
  }[] = [];

  for (const bundle of bundlesToProcess) {
    const result = await downloadAndProcessBundle(bundle, dryRun);
    results.push({ 
      bundle, 
      success: result.success, 
      processedStates: result.processedStates,
      error: result.error 
    });
    
    // Small delay between bundles to avoid overwhelming the system
    if (bundlesToProcess.indexOf(bundle) < bundlesToProcess.length - 1) {
      console.log('\n⏳ Pausing 5 seconds before next bundle...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  // Final summary
  console.log('\n' + '='.repeat(70));
  console.log('FINAL SUMMARY');
  console.log('='.repeat(70));

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  const allProcessedStates = results.flatMap(r => r.processedStates);

  if (successful.length > 0) {
    console.log(`\n✅ Successful Bundles (${successful.length}):`);
    successful.forEach(r => {
      console.log(`   ✓ ${r.bundle.name} (${r.processedStates.length} states)`);
    });
  }

  if (failed.length > 0) {
    console.log(`\n❌ Failed Bundles (${failed.length}):`);
    failed.forEach(r => {
      console.log(`   ✗ ${r.bundle.name}: ${r.error}`);
    });
  }

  console.log(`\n📊 Total States Processed: ${allProcessedStates.length}`);
  if (allProcessedStates.length > 0) {
    console.log(`   ${allProcessedStates.map(s => s.toUpperCase()).sort().join(', ')}`);
  }

  // Check for missing states
  const allExpectedStates = REGIONAL_BUNDLES.flatMap(b => b.expectedStates);
  const missingStates = allExpectedStates.filter(s => !allProcessedStates.includes(s));
  
  if (missingStates.length > 0 && !dryRun) {
    console.log(`\n⚠️  Missing States (${missingStates.length}):`);
    missingStates.forEach(s => {
      console.log(`   - ${STATE_NAMES[s] || s} (${s.toUpperCase()})`);
    });
  }

  console.log('\n' + '='.repeat(70));
  console.log(`Bundles: ${results.length} | Success: ${successful.length} | Failed: ${failed.length}`);
  console.log(`States: ${allProcessedStates.length}/${allExpectedStates.length}`);
  console.log('='.repeat(70));

  if (dryRun) {
    console.log('\n🔍 This was a DRY RUN. No files were actually uploaded.');
    console.log('   Remove --dry-run to perform actual upload.');
  }

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
