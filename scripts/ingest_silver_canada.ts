#!/usr/bin/env tsx
/**
 * Silver Tier Data Ingestion Script for Canada
 * 
 * Downloads StatCan Open Database of Addresses (ODA) for Canadian provinces
 * and uploads them directly to S3 without saving to local disk.
 * 
 * The ODA is a collection of open address point data made available under the 
 * Open Government License - Canada. It contains ~10 million records from 
 * 99 datasets originating from various government sources.
 * 
 * Usage:
 *   export AWS_ACCESS_KEY_ID=xxx
 *   export AWS_SECRET_ACCESS_KEY=xxx
 *   export AWS_REGION=us-east-1
 *   npx tsx scripts/ingest_silver_canada.ts
 * 
 * Optional: Specify regions to process:
 *   npx tsx scripts/ingest_silver_canada.ts on bc
 * 
 * Data Sources:
 *   - Statistics Canada Open Database of Addresses (ODA)
 *   - https://www.statcan.gc.ca/en/lode/databases/oda
 *   - ~10 million address records across Canada
 *   - Updated periodically (current version: v1.0, April 2021)
 */

import axios, { AxiosResponse } from 'axios';
import JSZip from 'jszip';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';

// ============================================================================
// CONFIGURATION
// ============================================================================

const BUCKET_NAME = process.env.AWS_BUCKET_NAME || 'silver-standard-addresses-canada';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

interface SilverSource {
  region: string;        // Province code: 'on', 'bc', 'ab', 'qc', etc.
  regionName: string;    // Human-readable name
  url: string;           // StatCan ODA download URL
  s3Prefix: string;      // S3 path prefix
  expectedSize: string;  // Human-readable expected file size
}

// StatCan ODA v1.0 (April 2021) - Province-level ZIP files
// Source: https://www.statcan.gc.ca/en/lode/databases/oda
const SILVER_SOURCES: SilverSource[] = [
  {
    region: 'on',
    regionName: 'Ontario',
    url: 'https://www150.statcan.gc.ca/n1/en/pub/46-26-0001/2021001/ODA_ON_v1.zip',
    s3Prefix: 'silver/ca/on',
    expectedSize: '~154 MB',
  },
  {
    region: 'bc',
    regionName: 'British Columbia',
    url: 'https://www150.statcan.gc.ca/n1/en/pub/46-26-0001/2021001/ODA_BC_v1.zip',
    s3Prefix: 'silver/ca/bc',
    expectedSize: '~89 MB',
  },
  {
    region: 'ab',
    regionName: 'Alberta',
    url: 'https://www150.statcan.gc.ca/n1/en/pub/46-26-0001/2021001/ODA_AB_v1.zip',
    s3Prefix: 'silver/ca/ab',
    expectedSize: '~47 MB',
  },
  {
    region: 'qc',
    regionName: 'Quebec',
    url: 'https://www150.statcan.gc.ca/n1/en/pub/46-26-0001/2021001/ODA_QC_v1.zip',
    s3Prefix: 'silver/ca/qc',
    expectedSize: '~77 MB',
  },
  {
    region: 'mb',
    regionName: 'Manitoba',
    url: 'https://www150.statcan.gc.ca/n1/en/pub/46-26-0001/2021001/ODA_MB_v1.zip',
    s3Prefix: 'silver/ca/mb',
    expectedSize: '~19 MB',
  },
  {
    region: 'sk',
    regionName: 'Saskatchewan',
    url: 'https://www150.statcan.gc.ca/n1/en/pub/46-26-0001/2021001/ODA_SK_v1.zip',
    s3Prefix: 'silver/ca/sk',
    expectedSize: '~14 MB',
  },
  {
    region: 'ns',
    regionName: 'Nova Scotia',
    url: 'https://www150.statcan.gc.ca/n1/en/pub/46-26-0001/2021001/ODA_NS_v1.zip',
    s3Prefix: 'silver/ca/ns',
    expectedSize: '~12 MB',
  },
  {
    region: 'nb',
    regionName: 'New Brunswick',
    url: 'https://www150.statcan.gc.ca/n1/en/pub/46-26-0001/2021001/ODA_NB_v1.zip',
    s3Prefix: 'silver/ca/nb',
    expectedSize: '~11 MB',
  },
  {
    region: 'pe',
    regionName: 'Prince Edward Island',
    url: 'https://www150.statcan.gc.ca/n1/en/pub/46-26-0001/2021001/ODA_PE_v1.zip',
    s3Prefix: 'silver/ca/pe',
    expectedSize: '~3 MB',
  },
  {
    region: 'nt',
    regionName: 'Northwest Territories',
    url: 'https://www150.statcan.gc.ca/n1/en/pub/46-26-0001/2021001/ODA_NT_v1.zip',
    s3Prefix: 'silver/ca/nt',
    expectedSize: '~2 MB',
  },
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

// ============================================================================
// DOWNLOAD & PROCESS
// ============================================================================

async function downloadAndProcessSource(source: SilverSource): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing: ${source.regionName} (${source.region.toUpperCase()})`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Source URL: ${source.url}`);
  console.log(`Expected size: ${source.expectedSize}`);
  console.log(`S3 Destination: s3://${BUCKET_NAME}/${source.s3Prefix}/addresses.csv`);
  console.log('');

  const startTime = Date.now();
  let downloadedBytes = 0;

  try {
    // Step 1: Download the ZIP file with progress tracking
    console.log(`📥 Downloading ${source.regionName} dataset from StatCan ODA...`);
    
    const response: AxiosResponse<ArrayBuffer> = await axios({
      method: 'GET',
      url: source.url,
      responseType: 'arraybuffer',
      timeout: 600000, // 10 minutes timeout for large files
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      onDownloadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          const loaded = formatBytes(progressEvent.loaded);
          const total = formatBytes(progressEvent.total);
          process.stdout.write(`\r  Progress: ${percent}% (${loaded} / ${total})`);
          downloadedBytes = progressEvent.loaded;
        } else {
          const loaded = formatBytes(progressEvent.loaded);
          process.stdout.write(`\r  Downloaded: ${loaded}`);
          downloadedBytes = progressEvent.loaded;
        }
      },
    });

    process.stdout.write('\n');
    console.log(`  ✓ Downloaded ${formatBytes(response.data.byteLength)}`);

    // Step 2: Extract ZIP in memory
    console.log(`\n📦 Extracting ZIP archive...`);
    const zipStartTime = Date.now();
    
    const zip = await JSZip.loadAsync(response.data);
    const zipDuration = Date.now() - zipStartTime;
    console.log(`  ✓ ZIP loaded in ${formatDuration(zipDuration)}`);

    // Find the CSV file
    const files = Object.keys(zip.files);
    console.log(`  Files in archive: ${files.length}`);
    
    // Look for the main CSV file (usually ODA_XX_v1.csv)
    let targetFile = files.find(f => f.toLowerCase().endsWith('.csv') && !f.startsWith('__MACOSX'));
    
    if (!targetFile) {
      console.error('  ✗ No CSV file found in archive');
      console.error(`  Available files: ${files.join(', ')}`);
      throw new Error('No CSV file found in ZIP archive');
    }

    console.log(`  Target file: ${targetFile}`);

    // Step 3: Extract file content as buffer
    console.log(`\n📄 Reading ${targetFile}...`);
    const fileData = await zip.files[targetFile].async('nodebuffer');
    console.log(`  ✓ CSV size: ${formatBytes(fileData.length)}`);

    // Estimate records from file size (rough estimate: ~150 bytes per line for CSV)
    const estimatedRecords = Math.floor(fileData.length / 150);
    console.log(`  ✓ Estimated records: ~${estimatedRecords.toLocaleString()}`);

    const s3Key = `${source.s3Prefix}/addresses.csv`;

    // Step 4: Upload to S3 using multipart upload for large files
    console.log(`\n☁️  Uploading to S3...`);
    console.log(`  Destination: s3://${BUCKET_NAME}/${s3Key}`);

    const uploadStartTime = Date.now();
    
    // Create a readable stream from the buffer
    const stream = Readable.from([fileData]);

    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Body: stream,
        ContentType: 'text/csv',
        Metadata: {
          'region': source.region,
          'region-name': source.regionName,
          'source-url': source.url,
          'source-type': 'statcan-oda',
          'source-version': '1.0',
          'original-filename': targetFile,
          'upload-date': new Date().toISOString(),
          'file-size-bytes': String(fileData.length),
          'estimated-records': String(estimatedRecords),
        },
      },
      partSize: 5 * 1024 * 1024, // 5MB parts for multipart upload
      leavePartsOnError: false,
    });

    // Track upload progress
    upload.on('httpUploadProgress', (progress) => {
      if (progress.total) {
        const percent = Math.round((progress.loaded! * 100) / progress.total);
        const loaded = formatBytes(progress.loaded!);
        const total = formatBytes(progress.total);
        process.stdout.write(`\r  Upload: ${percent}% (${loaded} / ${total})`);
      }
    });

    const uploadResult = await upload.done();
    const uploadDuration = Date.now() - uploadStartTime;
    
    process.stdout.write('\n');
    console.log(`  ✓ Upload complete in ${formatDuration(uploadDuration)}`);
    console.log(`  ETag: ${uploadResult.ETag}`);

    // Summary
    const totalDuration = Date.now() - startTime;
    console.log(`\n✅ ${source.regionName} - SUCCESS`);
    console.log(`   Total time: ${formatDuration(totalDuration)}`);
    console.log(`   Records: ~${estimatedRecords.toLocaleString()}`);
    console.log(`   S3 URL: https://${BUCKET_NAME}.s3.amazonaws.com/${s3Key}`);

  } catch (error: any) {
    console.error(`\n❌ ${source.regionName} - FAILED`);
    console.error(`   Error: ${error.message}`);
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
    }
    throw error;
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('========================================');
  console.log('Silver Tier Data Ingestion - Canada');
  console.log('StatCan Open Database of Addresses (ODA)');
  console.log('========================================');
  console.log(`Bucket: ${BUCKET_NAME}`);
  console.log(`Region: ${AWS_REGION}`);
  console.log(`Source: https://www.statcan.gc.ca/en/lode/databases/oda`);
  console.log('');

  // Validate environment
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('❌ Error: AWS credentials not found');
    console.error('   Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY');
    process.exit(1);
  }

  // Parse command line arguments for specific regions
  const args = process.argv.slice(2);
  let sourcesToProcess = SILVER_SOURCES;

  if (args.length > 0) {
    const requestedRegions = args.map(a => a.toLowerCase());
    sourcesToProcess = SILVER_SOURCES.filter(s => requestedRegions.includes(s.region));
    
    if (sourcesToProcess.length === 0) {
      console.error(`❌ No matching regions found for: ${args.join(', ')}`);
      console.error(`   Available: ${SILVER_SOURCES.map(s => s.region).join(', ')}`);
      process.exit(1);
    }
  }

  console.log(`Processing ${sourcesToProcess.length} region(s):`);
  sourcesToProcess.forEach(s => console.log(`  - ${s.regionName} (${s.region}): ${s.expectedSize}`));
  console.log('');

  const results: { source: SilverSource; success: boolean; error?: string }[] = [];

  for (const source of sourcesToProcess) {
    try {
      await downloadAndProcessSource(source);
      results.push({ source, success: true });
    } catch (error: any) {
      results.push({ source, success: false, error: error.message });
      // Continue with next source even if one fails
    }
  }

  // Final summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  if (successful.length > 0) {
    console.log(`\n✅ Successful (${successful.length}):`);
    successful.forEach(r => {
      console.log(`   ✓ ${r.source.regionName}`);
    });
  }

  if (failed.length > 0) {
    console.log(`\n❌ Failed (${failed.length}):`);
    failed.forEach(r => {
      console.log(`   ✗ ${r.source.regionName}: ${r.error}`);
    });
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Total: ${results.length} | Success: ${successful.length} | Failed: ${failed.length}`);
  console.log('='.repeat(60));

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
