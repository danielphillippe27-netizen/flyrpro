#!/usr/bin/env tsx
/**
 * S3 Silver Bucket Migration Script
 * 
 * Copies all objects from the temporary silver-standard-addresses-canada bucket
 * to the main data lake bucket flyr-pro-addresses-2025.
 * 
 * Usage:
 *   npx tsx scripts/migrate_silver_bucket.ts
 *   npx tsx scripts/migrate_silver_bucket.ts --dry-run
 * 
 * The script preserves the exact key structure (e.g., silver/ca/on/addresses.csv).
 */

import { 
  S3Client, 
  ListObjectsV2Command, 
  CopyObjectCommand,
  _Object 
} from '@aws-sdk/client-s3';
import * as dotenv from 'dotenv';
import { parseArgs } from 'util';

dotenv.config({ path: '.env.local' });

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Set to true to preview changes without actually copying */
const DRY_RUN = false;

/** Source bucket (temporary) */
const SOURCE_BUCKET = 'silver-standard-addresses-canada';

/** Destination bucket (main data lake) */
const DESTINATION_BUCKET = 'flyr-pro-addresses-2025';

/** AWS Region for S3 operations */
const S3_REGION = process.env.FLYR_ADDRESSES_S3_REGION || 'us-east-2';

/** Maximum concurrent copy operations */
const CONCURRENCY_LIMIT = 5;

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

interface CopyResult {
  key: string;
  success: boolean;
  error?: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * List all objects in the source bucket
 */
async function listAllObjects(bucket: string): Promise<_Object[]> {
  console.log(`Listing objects in s3://${bucket}...\n`);
  
  const objects: _Object[] = [];
  let continuationToken: string | undefined;
  
  do {
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    });
    
    const response = await s3Client.send(command);
    
    if (response.Contents) {
      objects.push(...response.Contents);
    }
    
    continuationToken = response.NextContinuationToken;
    
    if (continuationToken) {
      console.log(`  Fetched ${objects.length} objects so far...`);
    }
  } while (continuationToken);
  
  return objects;
}

/**
 * Copy a single object from source to destination using S3-to-S3 copy
 */
async function copyObject(key: string, dryRun: boolean): Promise<CopyResult> {
  const sourcePath = `${SOURCE_BUCKET}/${key}`;
  
  console.log(`Copying ${key}...`);
  
  if (dryRun) {
    console.log(`  [DRY RUN] Would copy: ${sourcePath} -> s3://${DESTINATION_BUCKET}/${key}`);
    return { key, success: true };
  }
  
  try {
    const command = new CopyObjectCommand({
      Bucket: DESTINATION_BUCKET,
      Key: key,
      CopySource: encodeURIComponent(sourcePath),
    });
    
    await s3Client.send(command);
    
    console.log(`  ✓ Success: ${key}`);
    return { key, success: true };
  } catch (error: any) {
    const errorMessage = error.message || String(error);
    console.error(`  ✗ Failed: ${key} - ${errorMessage}`);
    return { key, success: false, error: errorMessage };
  }
}

/**
 * Process an array of items with limited concurrency
 */
async function processWithConcurrency<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  limit: number
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];
  
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const promise = processor(item).then(result => {
      results[index] = result;
    });
    
    executing.push(promise);
    
    if (executing.length >= limit) {
      await Promise.race(executing);
      executing.splice(executing.findIndex(p => p === promise), 1);
    }
  }
  
  await Promise.all(executing);
  
  return results;
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'dry-run': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  
  if (values.help) {
    console.log(`
S3 Silver Bucket Migration Script

Copies all objects from silver-standard-addresses-canada to flyr-pro-addresses-2025.

Usage:
  npx tsx scripts/migrate_silver_bucket.ts [options]

Options:
  --dry-run    Preview changes without copying
  --help       Show this help

Environment Variables:
  AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
  FLYR_ADDRESSES_S3_REGION (defaults to us-east-2)

Examples:
  # Preview what would be copied
  npx tsx scripts/migrate_silver_bucket.ts --dry-run

  # Run the actual migration
  npx tsx scripts/migrate_silver_bucket.ts
`);
    process.exit(0);
  }
  
  // Validate environment
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('Error: AWS credentials not found');
    console.error('Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env.local');
    process.exit(1);
  }
  
  const dryRun = DRY_RUN || values['dry-run'] || false;
  
  console.log('='.repeat(60));
  console.log('S3 Silver Bucket Migration');
  console.log('='.repeat(60));
  console.log(`Source:      s3://${SOURCE_BUCKET}`);
  console.log(`Destination: s3://${DESTINATION_BUCKET}`);
  console.log(`Region:      ${S3_REGION}`);
  console.log(`Mode:        ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Concurrency: ${CONCURRENCY_LIMIT}`);
  console.log('='.repeat(60));
  console.log();
  
  // Step 1: List all objects
  const objects = await listAllObjects(SOURCE_BUCKET);
  
  if (objects.length === 0) {
    console.log('No objects found in source bucket. Nothing to migrate.');
    process.exit(0);
  }
  
  console.log(`\nFound ${objects.length} object(s) to migrate:\n`);
  
  // Show first few objects as preview
  const previewCount = Math.min(5, objects.length);
  for (let i = 0; i < previewCount; i++) {
    const obj = objects[i];
    const size = obj.Size ? ` (${formatBytes(obj.Size)})` : '';
    console.log(`  - ${obj.Key}${size}`);
  }
  if (objects.length > previewCount) {
    console.log(`  ... and ${objects.length - previewCount} more`);
  }
  console.log();
  
  // Step 2: Copy objects with concurrency limit
  console.log(`Starting migration with concurrency limit of ${CONCURRENCY_LIMIT}...\n`);
  
  const startTime = Date.now();
  const keys = objects.map(obj => obj.Key!).filter(Boolean);
  
  const results = await processWithConcurrency(
    keys,
    (key) => copyObject(key, dryRun),
    CONCURRENCY_LIMIT
  );
  
  const durationMs = Date.now() - startTime;
  
  // Step 3: Report results
  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;
  
  console.log('\n' + '='.repeat(60));
  console.log('MIGRATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total objects: ${results.length}`);
  console.log(`Successful:    ${successCount}`);
  console.log(`Failed:        ${failCount}`);
  console.log(`Duration:      ${(durationMs / 1000).toFixed(1)}s`);
  console.log('='.repeat(60));
  
  if (failCount > 0) {
    console.log('\nFailed copies:');
    results
      .filter(r => !r.success)
      .forEach(r => {
        console.log(`  - ${r.key}: ${r.error}`);
      });
  }
  
  if (dryRun) {
    console.log('\n[DRY RUN] No objects were actually copied.');
    console.log('Run without --dry-run to perform the actual migration.');
  } else if (failCount === 0) {
    console.log('\n✓ All objects copied successfully!');
    console.log('\nNext steps:');
    console.log('  1. Verify files in s3://flyr-pro-addresses-2025/');
    console.log('  2. Delete the old bucket manually in AWS Console:');
    console.log(`     s3://${SOURCE_BUCKET}`);
  }
  
  if (failCount > 0) process.exit(1);
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ============================================================================
// ENTRY POINT
// ============================================================================

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
