#!/usr/bin/env tsx
/**
 * Sync buildings from MotherDuck views to Supabase map_buildings table
 * 
 * Usage:
 *   # Sync by bounding box
 *   npx tsx scripts/sync-buildings-from-motherduck.ts --bbox -79.4 43.6 -79.3 43.7
 * 
 *   # Sync by bounding box with campaign ID
 *   npx tsx scripts/sync-buildings-from-motherduck.ts --bbox -79.4 43.6 -79.3 43.7 --campaign-id <uuid>
 * 
 *   # Sync a region (pre-population)
 *   npx tsx scripts/sync-buildings-from-motherduck.ts --region toronto --bbox -79.6 43.5 -79.0 43.9
 */

import * as dotenv from 'dotenv';
import { BuildingSyncService, type BoundingBox } from '@/lib/services/BuildingSyncService';

// Load environment variables
dotenv.config({ path: '.env.local' });
dotenv.config();

// Parse command line arguments
const args = process.argv.slice(2);

function parseArgs() {
  const result: {
    mode: 'bbox' | 'region';
    bbox?: BoundingBox;
    campaignId?: string;
    regionName?: string;
  } = {
    mode: 'bbox',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--bbox' && i + 4 < args.length) {
      result.bbox = {
        west: parseFloat(args[i + 1]),
        south: parseFloat(args[i + 2]),
        east: parseFloat(args[i + 3]),
        north: parseFloat(args[i + 4]),
      };
      i += 4;
    } else if (arg === '--campaign-id' && i + 1 < args.length) {
      result.campaignId = args[i + 1];
      i += 1;
    } else if (arg === '--region' && i + 1 < args.length) {
      result.mode = 'region';
      result.regionName = args[i + 1];
      i += 1;
    }
  }

  return result;
}

function validateBbox(bbox: BoundingBox): boolean {
  if (
    isNaN(bbox.west) || isNaN(bbox.south) || isNaN(bbox.east) || isNaN(bbox.north) ||
    bbox.west >= bbox.east ||
    bbox.south >= bbox.north ||
    bbox.west < -180 || bbox.west > 180 ||
    bbox.east < -180 || bbox.east > 180 ||
    bbox.south < -90 || bbox.south > 90 ||
    bbox.north < -90 || bbox.north > 90
  ) {
    return false;
  }
  return true;
}

async function main() {
  console.log('🏗️  Building Sync from MotherDuck to Supabase\n');

  // Check environment
  if (!process.env.MOTHERDUCK_TOKEN) {
    console.error('❌ Missing MOTHERDUCK_TOKEN environment variable');
    console.error('   Set it in .env.local or your environment');
    process.exit(1);
  }

  // Parse arguments
  const { mode, bbox, campaignId, regionName } = parseArgs();

  if (!bbox) {
    console.error('❌ Missing bounding box');
    console.error('');
    console.error('Usage:');
    console.error('  npx tsx scripts/sync-buildings-from-motherduck.ts --bbox <west> <south> <east> <north>');
    console.error('  npx tsx scripts/sync-buildings-from-motherduck.ts --bbox <west> <south> <east> <north> --campaign-id <uuid>');
    console.error('  npx tsx scripts/sync-buildings-from-motherduck.ts --region <name> --bbox <west> <south> <east> <north>');
    console.error('');
    console.error('Example:');
    console.error('  npx tsx scripts/sync-buildings-from-motherduck.ts --bbox -79.4 43.6 -79.3 43.7');
    process.exit(1);
  }

  if (!validateBbox(bbox)) {
    console.error('❌ Invalid bounding box');
    console.error(`   Provided: [${bbox.west}, ${bbox.south}, ${bbox.east}, ${bbox.north}]`);
    console.error('   Bounding box must have: west < east, south < north, valid lat/lon ranges');
    process.exit(1);
  }

  try {
    let result;

    if (mode === 'region') {
      console.log(`📍 Syncing region: ${regionName || 'unnamed'}`);
      console.log(`   BBox: [${bbox.west}, ${bbox.south}, ${bbox.east}, ${bbox.north}]\n`);
      
      result = await BuildingSyncService.syncRegion(regionName || 'unnamed', bbox);
    } else {
      console.log(`📍 Syncing bounding box`);
      console.log(`   BBox: [${bbox.west}, ${bbox.south}, ${bbox.east}, ${bbox.north}]`);
      if (campaignId) {
        console.log(`   Campaign ID: ${campaignId}`);
      }
      console.log('');

      result = await BuildingSyncService.syncBbox(bbox, campaignId);
    }

    // Print results
    console.log('\n✅ Sync complete!');
    console.log(`   Created: ${result.created}`);
    console.log(`   Updated: ${result.updated}`);
    console.log(`   Errors:  ${result.errors}`);
    console.log(`   Total:   ${result.total}`);

    if (result.errors > 0) {
      console.log('\n⚠️  Some buildings failed to sync. Check logs above for details.');
      process.exit(1);
    } else {
      console.log('\n🎉 All buildings synced successfully!');
      process.exit(0);
    }
  } catch (error) {
    console.error('\n❌ Sync failed:');
    if (error instanceof Error) {
      console.error('   Message:', error.message);
      if (error.stack) {
        console.error('   Stack:', error.stack);
      }
    } else {
      console.error('   Error:', JSON.stringify(error, null, 2));
    }
    process.exit(1);
  }
}

main();
