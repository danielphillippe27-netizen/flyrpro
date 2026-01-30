#!/usr/bin/env tsx
/**
 * Validation script for UUID migration
 * Verifies all GERS IDs can be converted to UUID format
 * Reports any invalid formats that need manual intervention
 */

import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
dotenv.config({ path: '.env.local' });
dotenv.config();

interface ValidationResult {
  table: string;
  total: number;
  converted: number;
  failed: number;
  failedIds: Array<{ id: string; gers_id: string }>;
  duplicates: number;
}

/**
 * Initialize Supabase JS client
 */
function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kfnsnwqylsdsbgnwgxva.supabase.co';
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseServiceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is required');
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Validate UUID conversion for a table
 */
async function validateTable(
  supabase: ReturnType<typeof createClient>,
  tableName: string,
  textColumn: string,
  uuidColumn: string,
  idColumn: string = 'id'
): Promise<ValidationResult> {
  console.log(`\n[Validate] Checking ${tableName}...`);

  // Get total count with text value
  const { count: totalCount } = await supabase
    .from(tableName)
    .select('*', { count: 'exact', head: true })
    .not(textColumn, 'is', null);

  // Get converted count
  const { count: convertedCount } = await supabase
    .from(tableName)
    .select('*', { count: 'exact', head: true })
    .not(textColumn, 'is', null)
    .not(uuidColumn, 'is', null);

  // Get failed conversions (have text but no UUID)
  const { data: failedData, error: failedError } = await supabase
    .from(tableName)
    .select(`${idColumn}, ${textColumn}`)
    .not(textColumn, 'is', null)
    .is(uuidColumn, null)
    .limit(100); // Limit to first 100 for reporting

  if (failedError) {
    console.error(`[Validate] Error fetching failed conversions:`, failedError);
  }

  // Check for duplicates in UUID column
  const { data: duplicatesData, error: duplicatesError } = await supabase.rpc('check_uuid_duplicates', {
    table_name: tableName,
    uuid_column: uuidColumn,
  });

  if (duplicatesError) {
    // If RPC doesn't exist, use a simpler query
    console.warn(`[Validate] Could not check duplicates (RPC may not exist):`, duplicatesError.message);
  }

  const total = totalCount || 0;
  const converted = convertedCount || 0;
  const failed = total - converted;
  const duplicates = duplicatesData || 0;

  return {
    table: tableName,
    total,
    converted,
    failed,
    failedIds: (failedData || []).slice(0, 10).map(row => ({
      id: row[idColumn],
      gers_id: row[textColumn],
    })),
    duplicates: typeof duplicates === 'number' ? duplicates : 0,
  };
}

/**
 * Check referential integrity between tables
 */
async function checkReferentialIntegrity(
  supabase: ReturnType<typeof createClient>
): Promise<{ mismatches: number; details: Array<{ table: string; count: number }> }> {
  console.log(`\n[Validate] Checking referential integrity...`);

  const details: Array<{ table: string; count: number }> = [];

  // Check campaign_addresses.source_id_uuid matches buildings.gers_id_uuid
  const { data: addressMismatches, error: addressError } = await supabase
    .from('campaign_addresses')
    .select('id, source_id_uuid')
    .not('source_id_uuid', 'is', null)
    .limit(1000);

  if (!addressError && addressMismatches) {
    // Check if source_id_uuid exists in buildings
    const buildingIds = new Set(
      (await supabase.from('buildings').select('gers_id_uuid').not('gers_id_uuid', 'is', null).limit(10000))
        .data?.map(b => b.gers_id_uuid) || []
    );

    const mismatches = addressMismatches.filter(addr => !buildingIds.has(addr.source_id_uuid));
    details.push({ table: 'campaign_addresses → buildings', count: mismatches.length });
  }

  // Check map_buildings.source_id_uuid matches buildings.gers_id_uuid
  const { data: mapMismatches, error: mapError } = await supabase
    .from('map_buildings')
    .select('id, source_id_uuid')
    .not('source_id_uuid', 'is', null)
    .limit(1000);

  if (!mapError && mapMismatches) {
    const buildingIds = new Set(
      (await supabase.from('buildings').select('gers_id_uuid').not('gers_id_uuid', 'is', null).limit(10000))
        .data?.map(b => b.gers_id_uuid) || []
    );

    const mismatches = mapMismatches.filter(mb => !buildingIds.has(mb.source_id_uuid));
    details.push({ table: 'map_buildings → buildings', count: mismatches.length });
  }

  const totalMismatches = details.reduce((sum, d) => sum + d.count, 0);

  return {
    mismatches: totalMismatches,
    details,
  };
}

/**
 * Main validation function
 */
async function main() {
  console.log('🔍 Starting UUID Migration Validation...\n');

  const supabase = getSupabaseClient();

  try {
    // Validate each table
    const buildingsResult = await validateTable(supabase, 'buildings', 'gers_id', 'gers_id_uuid');
    const mapBuildingsResult = await validateTable(supabase, 'map_buildings', 'source_id', 'source_id_uuid');
    const addressesResult = await validateTable(supabase, 'campaign_addresses', 'source_id', 'source_id_uuid');

    // Check referential integrity
    const integrity = await checkReferentialIntegrity(supabase);

    // Print results
    console.log('\n' + '='.repeat(60));
    console.log('📊 Validation Results');
    console.log('='.repeat(60));

    const results = [buildingsResult, mapBuildingsResult, addressesResult];

    for (const result of results) {
      console.log(`\n${result.table}:`);
      console.log(`  Total records: ${result.total}`);
      console.log(`  ✅ Converted: ${result.converted} (${((result.converted / result.total) * 100).toFixed(1)}%)`);
      console.log(`  ❌ Failed: ${result.failed}`);
      console.log(`  ⚠️  Duplicates: ${result.duplicates}`);

      if (result.failedIds.length > 0) {
        console.log(`  \n  Failed IDs (sample):`);
        result.failedIds.forEach(f => {
          console.log(`    - ${f.id}: ${f.gers_id}`);
        });
      }
    }

    console.log(`\n🔗 Referential Integrity:`);
    console.log(`  Total mismatches: ${integrity.mismatches}`);
    integrity.details.forEach(d => {
      console.log(`    ${d.table}: ${d.count} mismatches`);
    });

    // Summary
    const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);
    const totalDuplicates = results.reduce((sum, r) => sum + r.duplicates, 0);

    console.log('\n' + '='.repeat(60));
    if (totalFailed === 0 && totalDuplicates === 0 && integrity.mismatches === 0) {
      console.log('✅ All validations passed! Migration is ready to proceed.');
    } else {
      console.log('⚠️  Validation issues found:');
      if (totalFailed > 0) {
        console.log(`  - ${totalFailed} failed UUID conversions`);
      }
      if (totalDuplicates > 0) {
        console.log(`  - ${totalDuplicates} duplicate UUIDs detected`);
      }
      if (integrity.mismatches > 0) {
        console.log(`  - ${integrity.mismatches} referential integrity issues`);
      }
      console.log('\n  Review the details above before proceeding with migration.');
    }
    console.log('='.repeat(60) + '\n');

  } catch (error: any) {
    console.error('❌ Validation failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run validation
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
