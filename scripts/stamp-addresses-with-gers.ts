#!/usr/bin/env tsx
/**
 * One-time migration script to stamp campaign_addresses with GERS IDs
 * 
 * Node-First Architecture: Uses Supabase JS client (HTTPS) instead of direct database connections
 * This script performs a one-time spatial join (ST_Intersects) between
 * address coordinates and Overture building footprints to populate
 * the source_id column with Overture GERS IDs.
 * 
 * Usage:
 *   npx tsx scripts/stamp-addresses-with-gers.ts [campaignId?]
 * 
 * Examples:
 *   npx tsx scripts/stamp-addresses-with-gers.ts                    # All campaigns
 *   npx tsx scripts/stamp-addresses-with-gers.ts abc123-def456     # Specific campaign
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import duckdb from 'duckdb';
import { normalizeGersId } from '../lib/utils/uuid';
import { prepareUpsertWithDoubleWrite } from '../lib/utils/double-write';

// Load environment variables
// #region agent log
const envLocalPath = path.join(process.cwd(), '.env.local');
const envPath = path.join(process.cwd(), '.env');
const envLocalExists = fs.existsSync(envLocalPath);
const envExists = fs.existsSync(envPath);
fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'stamp-addresses-with-gers.ts:23',message:'Checking env files before dotenv load',data:{envLocalPath,envPath,envLocalExists,envExists,cwd:process.cwd()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
// #endregion

const envLocalResult = dotenv.config({ path: '.env.local' });
// #region agent log
fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'stamp-addresses-with-gers.ts:28',message:'After dotenv.config(.env.local)',data:{error:envLocalResult.error?.message||null,parsed:envLocalResult.parsed?Object.keys(envLocalResult.parsed).length:0,hasSupabaseServiceRoleKey:!!(envLocalResult.parsed?.SUPABASE_SERVICE_ROLE_KEY),hasSupabaseDbPassword:!!(envLocalResult.parsed?.SUPABASE_DB_PASSWORD)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
// #endregion

const envResult = dotenv.config();
// #region agent log
fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'stamp-addresses-with-gers.ts:33',message:'After dotenv.config() default',data:{error:envResult.error?.message||null,parsed:envResult.parsed?Object.keys(envResult.parsed).length:0,hasSupabaseServiceRoleKey:!!(envResult.parsed?.SUPABASE_SERVICE_ROLE_KEY)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
// #endregion

// #region agent log
const allEnvKeys = Object.keys(process.env).filter(k => k.includes('SUPABASE') || k.includes('MOTHERDUCK'));
const envVarsSummary = allEnvKeys.reduce((acc, key) => {
  acc[key] = process.env[key] ? `${process.env[key]?.substring(0, 5)}...` : 'undefined';
  return acc;
}, {} as Record<string, string>);
fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'stamp-addresses-with-gers.ts:40',message:'Environment variables after dotenv load',data:{hasSupabaseServiceRoleKey:!!process.env.SUPABASE_SERVICE_ROLE_KEY,hasSupabaseDbPassword:!!process.env.SUPABASE_DB_PASSWORD,hasMotherDuckToken:!!process.env.MOTHERDUCK_TOKEN,relevantEnvKeys:allEnvKeys,envVarsSummary},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
// #endregion

interface StampStats {
  total: number;
  matched: number;
  unmatched: number;
  errors: number;
  unmatchedAddresses: Array<{
    id: string;
    address: string;
    formatted?: string;
    campaign_id: string;
  }>;
}

interface AddressToStamp {
  id: string;
  campaign_id: string;
  address?: string;
  formatted?: string;
  latitude: number;
  longitude: number;
}

/**
 * Initialize Supabase JS client
 */
function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kfnsnwqylsdsbgnwgxva.supabase.co';
  // Try SUPABASE_SERVICE_ROLE_KEY first, fallback to hardcoded key (same as lib/supabase/server.ts)
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmbnNud3F5bHNkc2JnbndneHZhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDkyNjczMSwiZXhwIjoyMDc2NTAyNzMxfQ.DCCPBeHISbRcz4Z-tSaGvjszB-un0vvp45avmv9YPas';

  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'stamp-addresses-with-gers.ts:79',message:'getSupabaseClient called',data:{hasSupabaseServiceRoleKey:!!process.env.SUPABASE_SERVICE_ROLE_KEY,usingFallback:!process.env.SUPABASE_SERVICE_ROLE_KEY,hasSupabaseUrl:!!supabaseUrl,supabaseUrl,serviceKeyLength:supabaseServiceKey?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
  // #endregion

  if (!supabaseServiceKey) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'stamp-addresses-with-gers.ts:85',message:'SUPABASE_SERVICE_ROLE_KEY missing',data:{allSupabaseKeys:Object.keys(process.env).filter(k=>k.includes('SUPABASE'))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
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

  // Load spatial extension
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
 * Fetch addresses that need stamping via Supabase JS client
 * Selects: id, formatted, geom (PostGIS Geography returned as GeoJSON Point)
 */
async function fetchAddressesToStamp(
  supabase: ReturnType<typeof createClient>,
  campaignId?: string
): Promise<AddressToStamp[]> {
  console.log('[Stamp] Fetching addresses via Supabase JS client...');

  // Select only the columns we need: id, formatted, geom
  // geom is a PostGIS Geography object, Supabase returns it as GeoJSON Point: { type: 'Point', coordinates: [lon, lat] }
  let query = supabase
    .from('campaign_addresses')
    .select('id, campaign_id, formatted, geom')
    .is('source_id', null)
    .not('geom', 'is', null);

  if (campaignId) {
    query = query.eq('campaign_id', campaignId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch addresses: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return [];
  }

  // Extract coordinates from geom (PostGIS Geography returned as GeoJSON Point)
  const addresses: AddressToStamp[] = [];

  for (const addr of data) {
    let lat: number | null = null;
    let lon: number | null = null;

    // geom is a PostGIS Geography object, Supabase returns it as GeoJSON Point
    // Format: { type: 'Point', coordinates: [lon, lat] }
    if (addr.geom) {
      if (typeof addr.geom === 'object') {
        // GeoJSON Point format: { type: 'Point', coordinates: [lon, lat] }
        if (addr.geom.type === 'Point' && Array.isArray(addr.geom.coordinates)) {
          const coords = addr.geom.coordinates;
          if (coords.length >= 2) {
            lon = coords[0]; // First element is longitude
            lat = coords[1]; // Second element is latitude
          }
        }
        // Handle case where geom might be nested
        else if (addr.geom.coordinates && Array.isArray(addr.geom.coordinates)) {
          const coords = addr.geom.coordinates;
          if (coords.length >= 2) {
            lon = coords[0];
            lat = coords[1];
          }
        }
      } else if (typeof addr.geom === 'string') {
        // Try to parse as JSON string
        try {
          const parsed = JSON.parse(addr.geom);
          if (parsed.type === 'Point' && Array.isArray(parsed.coordinates)) {
            const coords = parsed.coordinates;
            if (coords.length >= 2) {
              lon = coords[0];
              lat = coords[1];
            }
          }
        } catch (e) {
          // Not JSON, skip this address
          console.warn(`[Stamp] Failed to parse geom for address ${addr.id}:`, e);
        }
      }
    }

    if (lat && lon) {
      addresses.push({
        id: addr.id,
        campaign_id: addr.campaign_id,
        address: addr.formatted || undefined,
        formatted: addr.formatted || undefined,
        latitude: lat,
        longitude: lon,
      });
    } else {
      console.warn(`[Stamp] Could not extract coordinates from geom for address ${addr.id}`);
    }
  }

  console.log(`[Stamp] Found ${addresses.length} addresses with valid coordinates out of ${data.length} total`);
  return addresses;
}

/**
 * Perform spatial join in DuckDB to find matching GERS IDs
 */
async function findGersIds(
  conn: duckdb.Connection,
  addresses: AddressToStamp[]
): Promise<Map<string, string>> {
  const OVERTURE_RELEASE = '2025-12-17.0';
  const OVERTURE_BUILDINGS_PATH = `s3://overturemaps-us-west-2/release/${OVERTURE_RELEASE}/theme=buildings/type=building/*`;

  console.log(`[Stamp] Creating temporary table with ${addresses.length} address points...`);

  // Create temporary table for address points
  // Use id, lon, lat columns (extracted from geom GeoJSON Point)
  await new Promise<void>((resolve, reject) => {
    conn.exec(`
      CREATE TEMP TABLE IF NOT EXISTS temp_stamp_addresses (
        id VARCHAR,
        lon DOUBLE,
        lat DOUBLE
      );
      DELETE FROM temp_stamp_addresses;
    `, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  // Insert address points with lon/lat extracted from geom
  for (const addr of addresses) {
    const insertSQL = `
      INSERT INTO temp_stamp_addresses (id, lon, lat)
      VALUES (
        '${addr.id.replace(/'/g, "''")}',
        ${addr.longitude},
        ${addr.latitude}
      );
    `;

    await new Promise<void>((resolve) => {
      conn.exec(insertSQL, (err) => {
        if (err) {
          console.warn(`[Stamp] Failed to insert address ${addr.id}:`, err.message);
        }
        resolve();
      });
    });
  }

  console.log('[Stamp] Performing address-to-building matching...');

  // Priority 1: Direct building_id match (O(1) - fastest)
  // Recent Overture Address theme releases include building_id or parent_id field
  // Priority 2: Spatial join (O(n log n) - fallback for addresses without direct match)
  const OVERTURE_ADDRESSES_PATH = `s3://overturemaps-us-west-2/release/${OVERTURE_RELEASE}/theme=addresses/type=address/*`;
  
  const matchQuery = `
    WITH address_points AS (
      SELECT 
        t.id AS address_id,
        ST_Point(t.lon, t.lat) AS point_geom
      FROM temp_stamp_addresses t
    ),
    direct_matches AS (
      -- Priority 1: Direct building_id match from Address theme (fastest - O(1))
      SELECT 
        ap.address_id,
        a.building_id AS gers_id,
        'direct' AS match_type
      FROM address_points ap
      INNER JOIN read_parquet('${OVERTURE_ADDRESSES_PATH}') a
        ON ST_Intersects(ap.point_geom, a.geometry)
      WHERE a.building_id IS NOT NULL
      QUALIFY ROW_NUMBER() OVER (PARTITION BY ap.address_id ORDER BY ST_Distance(ap.point_geom, a.geometry)) = 1
    ),
    spatial_matches AS (
      -- Priority 2: Spatial join with Buildings theme (fallback - O(n log n))
      SELECT 
        ap.address_id,
        o.id AS gers_id,
        'spatial' AS match_type
      FROM address_points ap
      INNER JOIN read_parquet('${OVERTURE_BUILDINGS_PATH}') o
        ON ST_Intersects(ap.point_geom, o.geometry)
      WHERE o.geometry IS NOT NULL
        -- Exclude addresses that already have direct matches
        AND NOT EXISTS (
          SELECT 1 FROM direct_matches dm WHERE dm.address_id = ap.address_id
        )
      QUALIFY ROW_NUMBER() OVER (PARTITION BY ap.address_id ORDER BY ST_Distance(ap.point_geom, o.geometry)) = 1
    )
    -- Combine direct and spatial matches
    SELECT address_id, gers_id, match_type
    FROM direct_matches
    UNION ALL
    SELECT address_id, gers_id, match_type
    FROM spatial_matches
  `;

  const matches = await new Promise<any[]>((resolve, reject) => {
    conn.all(matchQuery, (err, rows: any[]) => {
      if (err) {
        console.error('[Stamp] Failed to find matches:', err.message);
        reject(err);
        return;
      }
      resolve(rows || []);
    });
  });

  // Create map of address_id -> gers_id and track match types
  const gersIdMap = new Map<string, string>();
  let directMatches = 0;
  let spatialMatches = 0;
  
  for (const match of matches) {
    gersIdMap.set(match.address_id, match.gers_id);
    if (match.match_type === 'direct') {
      directMatches++;
    } else if (match.match_type === 'spatial') {
      spatialMatches++;
    }
  }

  console.log(`[Stamp] Found ${gersIdMap.size} matches out of ${addresses.length} addresses`);
  console.log(`[Stamp] Match types: ${directMatches} direct (building_id), ${spatialMatches} spatial (ST_Intersects)`);

  // Cleanup temp table
  await new Promise<void>((resolve) => {
    conn.exec('DROP TABLE IF EXISTS temp_stamp_addresses;', (err) => {
      if (err) console.warn('[Stamp] Failed to cleanup temp table:', err.message);
      resolve();
    });
  });

  return gersIdMap;
}

/**
 * Update source_id in Supabase via JS client using bulk upsert
 */
async function updateSourceIds(
  supabase: ReturnType<typeof createClient>,
  gersIdMap: Map<string, string>
): Promise<{ success: number; errors: number }> {
  console.log(`[Stamp] Updating ${gersIdMap.size} addresses via Supabase JS client (bulk upsert)...`);

  // Prepare bulk updates array
  // Normalize GERS IDs to UUID format and support double-write during migration
  const updates = Array.from(gersIdMap.entries()).map(([addressId, gersId]) => {
    const normalized = normalizeGersId(gersId);
    if (!normalized) {
      console.warn(`[Stamp] Invalid GERS ID format: ${gersId} for address ${addressId}`);
    }
    return {
      id: addressId,
      source_id: normalized || gersId, // Fallback to original if normalization fails
    };
  });

  // During UUID migration: double-write to both source_id and source_id_uuid
  const upsertData = prepareUpsertWithDoubleWrite(updates, 'source_id');

  // Use upsert for bulk update (much faster than individual updates)
  // Upsert will update existing rows based on the 'id' field
  const { data, error } = await supabase
    .from('campaign_addresses')
    .upsert(upsertData, {
      onConflict: 'id', // Update existing rows based on id
    });

  if (error) {
    console.error(`[Stamp] Bulk upsert failed:`, error.message);
    return { success: 0, errors: updates.length };
  }

  console.log(`[Stamp] Successfully updated ${updates.length} addresses in a single bulk operation`);
  return { success: updates.length, errors: 0 };
}

/**
 * Main execution function
 */
async function main() {
  const campaignId = process.argv[2]; // Optional campaign ID

  // Validate environment variables
  const motherDuckToken = process.env.MOTHERDUCK_TOKEN;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!motherDuckToken) {
    console.error('❌ MOTHERDUCK_TOKEN environment variable is required');
    process.exit(1);
  }

  if (!supabaseServiceKey) {
    console.error('❌ SUPABASE_SERVICE_ROLE_KEY environment variable is required');
    console.error('');
    console.error('   To get your Service Role Key:');
    console.error('   1. Go to https://supabase.com/dashboard');
    console.error('   2. Select your project (kfnsnwqylsdsbgnwgxva)');
    console.error('   3. Navigate to Settings → API');
    console.error('   4. Find the "service_role" key (NOT the anon key)');
    console.error('   5. Copy the secret key');
    console.error('   6. Add to .env.local: SUPABASE_SERVICE_ROLE_KEY=your_key_here');
    console.error('');
    process.exit(1);
  }

  console.log('🚀 Starting GERS ID stamping migration (Node-First Architecture)...');
  if (campaignId) {
    console.log(`   Campaign ID: ${campaignId}`);
  } else {
    console.log('   All campaigns');
  }
  console.log('');

  let conn: duckdb.Connection | null = null;

  try {
    // Initialize Supabase JS client
    const supabase = getSupabaseClient();
    console.log('[Stamp] Supabase JS client initialized');

    // Get DuckDB connection
    console.log('[Stamp] Initializing DuckDB connection...');
    conn = await getConnection();
    console.log('[Stamp] DuckDB connection established');

    // Fetch addresses via Supabase JS client
    const addresses = await fetchAddressesToStamp(supabase, campaignId);
    console.log(`[Stamp] Found ${addresses.length} addresses to stamp`);

    if (addresses.length === 0) {
      console.log('✅ No addresses need stamping. All addresses already have source_id.');
      return;
    }

    // Perform spatial join in DuckDB to find GERS IDs
    const gersIdMap = await findGersIds(conn, addresses);

    // Update source_id via Supabase JS client
    const updateStats = await updateSourceIds(supabase, gersIdMap);

    // Calculate stats
    const stats: StampStats = {
      total: addresses.length,
      matched: updateStats.success,
      unmatched: addresses.length - gersIdMap.size,
      errors: updateStats.errors,
      unmatchedAddresses: addresses
        .filter(addr => !gersIdMap.has(addr.id))
        .map(addr => ({
          id: addr.id,
          address: addr.address || '',
          formatted: addr.formatted,
          campaign_id: addr.campaign_id,
        })),
    };

    // Print results
    console.log('');
    console.log('📊 Stamping Results:');
    console.log(`   Total addresses: ${stats.total}`);
    console.log(`   ✅ Matched: ${stats.matched}`);
    console.log(`   ❌ Unmatched: ${stats.unmatched}`);
    console.log(`   ⚠️  Errors: ${stats.errors}`);
    console.log('');

    if (stats.unmatchedAddresses.length > 0) {
      console.log('⚠️  Unmatched Addresses (first 10):');
      stats.unmatchedAddresses.slice(0, 10).forEach(addr => {
        console.log(`   - ${addr.formatted || addr.address} (ID: ${addr.id}, Campaign: ${addr.campaign_id})`);
      });
      if (stats.unmatchedAddresses.length > 10) {
        console.log(`   ... and ${stats.unmatchedAddresses.length - 10} more`);
      }
      console.log('');
    }

    const successRate = stats.total > 0 
      ? ((stats.matched / stats.total) * 100).toFixed(1)
      : '0.0';
    console.log(`✅ Success rate: ${successRate}%`);
    console.log('');

    if (stats.matched > 0) {
      console.log('🎉 Migration completed successfully!');
      console.log('   Next steps:');
      console.log('   1. Verify source_id values in Supabase');
      console.log('   2. Run bake.sql to generate PMTiles with GERS IDs');
      console.log('   3. Update frontend to use GERS ID lookups');
    } else {
      console.log('⚠️  No addresses were matched. Check:');
      console.log('   - Address coordinates are valid');
      console.log('   - Overture data is accessible');
      console.log('   - Spatial join logic is correct');
    }

  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
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
