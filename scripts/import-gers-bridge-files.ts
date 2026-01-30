#!/usr/bin/env tsx
/**
 * Import Overture Bridge Files for GERS ID Churn Handling
 * 
 * Overture occasionally "churns" IDs (reassigns new ID if source data changes significantly).
 * Bridge files are monthly parity files that map "Old GERS ID" → "New GERS ID".
 * 
 * Usage:
 *   npx tsx scripts/import-gers-bridge-files.ts [release-date] [s3-path]
 * 
 * Examples:
 *   npx tsx scripts/import-gers-bridge-files.ts 2025-01-15
 *   npx tsx scripts/import-gers-bridge-files.ts 2025-01-15 s3://overturemaps-us-west-2/release/2025-01-15.0/bridge/buildings/
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import duckdb from 'duckdb';
import { normalizeGersId } from '../lib/utils/uuid';

// Load environment variables
dotenv.config({ path: '.env.local' });
dotenv.config();

interface BridgeMapping {
  old_gers_id: string;
  new_gers_id: string;
  mapping_type: '1:1' | 'Many:1' | '1:Many';
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
 * Get or create DuckDB connection with spatial extension
 */
async function getConnection(): Promise<duckdb.Connection> {
  const motherDuckToken = process.env.MOTHERDUCK_TOKEN;
  const connectionString = motherDuckToken ? 'md:' : ':memory:';

  const db = new duckdb.Database(connectionString);
  const conn = db.connect();

  // Set home directory
  await new Promise<void>((resolve) => {
    conn.exec("SET home_directory='/tmp/duckdb';", (err) => {
      if (err) console.warn('Failed to set home_directory:', err.message);
      resolve();
    });
  });

  // Load spatial extension (may not be needed for bridge files, but good to have)
  await new Promise<void>((resolve, reject) => {
    conn.exec('INSTALL spatial; LOAD spatial;', (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  // Set S3 region for Overture access
  await new Promise<void>((resolve) => {
    conn.exec("SET s3_region='us-west-2';", (err) => {
      if (err) console.warn('Failed to set S3 region:', err.message);
      resolve();
    });
  });

  return conn;
}

/**
 * Parse Overture bridge file from S3
 * Bridge files are typically Parquet files with old_id and new_id columns
 */
async function parseBridgeFile(
  conn: duckdb.Connection,
  s3Path: string,
  releaseDate: string
): Promise<BridgeMapping[]> {
  console.log(`[Bridge] Parsing bridge file from: ${s3Path}`);

  // Query bridge file structure may vary by Overture release
  // Common structure: old_id, new_id columns in Parquet format
  const query = `
    SELECT 
      old_id as old_gers_id,
      new_id as new_gers_id
    FROM read_parquet('${s3Path}')
    WHERE old_id IS NOT NULL AND new_id IS NOT NULL
  `;

  const rows = await new Promise<any[]>((resolve, reject) => {
    conn.all(query, (err, results: any[]) => {
      if (err) {
        console.error('[Bridge] Failed to parse bridge file:', err.message);
        reject(err);
        return;
      }
      resolve(results || []);
    });
  });

  console.log(`[Bridge] Found ${rows.length} mappings in bridge file`);

  // Determine mapping type and normalize IDs
  const mappings: BridgeMapping[] = [];
  const oldIdCounts = new Map<string, number>();
  const newIdCounts = new Map<string, number>();

  // Count occurrences to determine mapping type
  for (const row of rows) {
    const oldCount = oldIdCounts.get(row.old_gers_id) || 0;
    const newCount = newIdCounts.get(row.new_gers_id) || 0;
    oldIdCounts.set(row.old_gers_id, oldCount + 1);
    newIdCounts.set(row.new_gers_id, newCount + 1);
  }

  // Classify mappings
  for (const row of rows) {
    const oldCount = oldIdCounts.get(row.old_gers_id) || 0;
    const newCount = newIdCounts.get(row.new_gers_id) || 0;

    let mappingType: '1:1' | 'Many:1' | '1:Many' = '1:1';
    if (oldCount > 1 && newCount === 1) {
      mappingType = 'Many:1'; // Multiple old IDs map to one new ID (merge)
    } else if (oldCount === 1 && newCount > 1) {
      mappingType = '1:Many'; // One old ID maps to multiple new IDs (split)
    }

    const normalizedOld = normalizeGersId(row.old_gers_id);
    const normalizedNew = normalizeGersId(row.new_gers_id);

    if (normalizedOld && normalizedNew) {
      mappings.push({
        old_gers_id: normalizedOld,
        new_gers_id: normalizedNew,
        mapping_type: mappingType,
      });
    } else {
      console.warn(`[Bridge] Skipping invalid GERS ID mapping: ${row.old_gers_id} → ${row.new_gers_id}`);
    }
  }

  console.log(`[Bridge] Processed ${mappings.length} valid mappings`);
  console.log(`[Bridge] Mapping types: 1:1=${mappings.filter(m => m.mapping_type === '1:1').length}, Many:1=${mappings.filter(m => m.mapping_type === 'Many:1').length}, 1:Many=${mappings.filter(m => m.mapping_type === '1:Many').length}`);

  return mappings;
}

/**
 * Import mappings into Supabase
 */
async function importMappings(
  supabase: ReturnType<typeof createClient>,
  mappings: BridgeMapping[],
  releaseDate: string
): Promise<{ inserted: number; errors: number }> {
  console.log(`[Bridge] Importing ${mappings.length} mappings into Supabase...`);

  const insertData = mappings.map(m => ({
    old_gers_id: m.old_gers_id,
    new_gers_id: m.new_gers_id,
    release_date: releaseDate,
    mapping_type: m.mapping_type,
  }));

  // Use upsert to handle duplicate releases
  const { data, error } = await supabase
    .from('gers_id_mapping')
    .upsert(insertData, {
      onConflict: 'old_gers_id,release_date',
      ignoreDuplicates: false,
    });

  if (error) {
    console.error(`[Bridge] Failed to import mappings:`, error.message);
    return { inserted: 0, errors: mappings.length };
  }

  console.log(`[Bridge] Successfully imported ${mappings.length} mappings`);
  return { inserted: mappings.length, errors: 0 };
}

/**
 * Main execution function
 */
async function main() {
  const releaseDate = process.argv[2]; // Format: YYYY-MM-DD
  const s3Path = process.argv[3]; // Optional: full S3 path to bridge file

  if (!releaseDate) {
    console.error('❌ Release date is required');
    console.error('   Usage: npx tsx scripts/import-gers-bridge-files.ts [release-date] [s3-path]');
    console.error('   Example: npx tsx scripts/import-gers-bridge-files.ts 2025-01-15');
    process.exit(1);
  }

  // Validate release date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) {
    console.error('❌ Invalid release date format. Use YYYY-MM-DD');
    process.exit(1);
  }

  // Default S3 path if not provided
  const defaultS3Path = s3Path || `s3://overturemaps-us-west-2/release/${releaseDate}.0/bridge/buildings/*.parquet`;

  // Validate environment variables
  const motherDuckToken = process.env.MOTHERDUCK_TOKEN;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!motherDuckToken) {
    console.error('❌ MOTHERDUCK_TOKEN environment variable is required');
    process.exit(1);
  }

  if (!supabaseServiceKey) {
    console.error('❌ SUPABASE_SERVICE_ROLE_KEY environment variable is required');
    process.exit(1);
  }

  console.log('🚀 Starting GERS Bridge File Import...');
  console.log(`   Release Date: ${releaseDate}`);
  console.log(`   S3 Path: ${defaultS3Path}`);
  console.log('');

  let conn: duckdb.Connection | null = null;

  try {
    // Initialize Supabase JS client
    const supabase = getSupabaseClient();
    console.log('[Bridge] Supabase JS client initialized');

    // Get DuckDB connection
    console.log('[Bridge] Initializing DuckDB connection...');
    conn = await getConnection();
    console.log('[Bridge] DuckDB connection established');

    // Parse bridge file
    const mappings = await parseBridgeFile(conn, defaultS3Path, releaseDate);

    if (mappings.length === 0) {
      console.warn('⚠️  No mappings found in bridge file. Exiting.');
      return;
    }

    // Import mappings
    const result = await importMappings(supabase, mappings, releaseDate);

    // Print results
    console.log('');
    console.log('📊 Import Results:');
    console.log(`   ✅ Inserted: ${result.inserted}`);
    console.log(`   ❌ Errors: ${result.errors}`);
    console.log('');

    if (result.inserted > 0) {
      console.log('🎉 Bridge file import completed successfully!');
      console.log('   Next steps:');
      console.log('   1. Review mappings in gers_id_mapping table');
      console.log('   2. Run update_gers_ids_from_mapping() function to update existing records');
      console.log('   3. Verify updated buildings and addresses');
    }

  } catch (error: any) {
    console.error('❌ Import failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    if (conn) {
      try {
        conn.close();
      } catch (err) {
        // Ignore cleanup errors
      }
    }
  }
}

// Run the script
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
