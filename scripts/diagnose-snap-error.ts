#!/usr/bin/env tsx
/**
 * Diagnostic script to test the snap-to-roads functionality
 * Run: npx tsx scripts/diagnose-snap-error.ts
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kfnsnwqylsdsbgnwgxva.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY environment variable is required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Test polygon (a simple square in San Francisco area)
const testPolygon = {
  type: 'Polygon' as const,
  coordinates: [[
    [-122.4194, 37.7749],
    [-122.4184, 37.7749],
    [-122.4184, 37.7759],
    [-122.4194, 37.7759],
    [-122.4194, 37.7749],
  ]],
};

async function diagnose() {
  console.log('=== Snap-to-Roads Diagnostic ===\n');

  // 1. Test basic connectivity
  console.log('1. Testing basic connectivity...');
  const { data: healthCheck, error: healthError } = await supabase
    .from('campaigns')
    .select('count')
    .limit(1);
  
  if (healthError) {
    console.error('   ❌ Database connection failed:', healthError.message);
    return;
  }
  console.log('   ✅ Database connection OK\n');

  // 2. Check if overture_transportation table exists and has data
  console.log('2. Checking overture_transportation table...');
  const { data: tableCheck, error: tableError } = await supabase
    .from('overture_transportation')
    .select('count')
    .limit(1);
  
  if (tableError) {
    console.error('   ❌ overture_transportation table error:', tableError.message);
    console.error('   Code:', tableError.code);
  } else {
    console.log('   ✅ overture_transportation table accessible\n');
  }

  // 3. Test get_roads_in_bbox RPC directly
  console.log('3. Testing get_roads_in_bbox RPC...');
  console.log('   Test bbox: [-122.42, 37.774, -122.418, 37.776] (SF area)');
  
  try {
    const { data: roads, error: roadsError } = await supabase.rpc('get_roads_in_bbox', {
      min_lon: -122.42,
      min_lat: 37.774,
      max_lon: -122.418,
      max_lat: 37.776,
    });

    if (roadsError) {
      console.error('   ❌ get_roads_in_bbox failed:', roadsError.message);
      console.error('   Code:', roadsError.code);
      console.error('   Details:', roadsError.details);
      console.error('   Hint:', roadsError.hint);
    } else {
      console.log('   ✅ get_roads_in_bbox succeeded');
      console.log('   Roads found:', roads?.length || 0);
      if (roads && roads.length > 0) {
        console.log('   Sample road:', JSON.stringify(roads[0], null, 2).substring(0, 200));
      }
    }
  } catch (e) {
    console.error('   ❌ Exception thrown:', e);
  }
  console.log();

  // 4. Test update_campaign_boundary RPC
  console.log('4. Testing update_campaign_boundary RPC...');
  
  // First, get a real campaign ID
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('id')
    .limit(1)
    .single();
  
  if (campaignError || !campaign) {
    console.error('   ⚠️  No campaigns found to test with. Skipping update test.\n');
  } else {
    console.log('   Using campaign:', campaign.id);
    
    try {
      const { data: updateResult, error: updateError } = await supabase.rpc('update_campaign_boundary', {
        p_campaign_id: campaign.id,
        p_boundary_geojson: testPolygon,
        p_raw_geojson: testPolygon,
        p_is_snapped: false,
      });

      if (updateError) {
        console.error('   ❌ update_campaign_boundary failed:', updateError.message);
        console.error('   Code:', updateError.code);
        console.error('   Details:', updateError.details);
      } else {
        console.log('   ✅ update_campaign_boundary succeeded');
        console.log('   Result:', JSON.stringify(updateResult, null, 2).substring(0, 200));
      }
    } catch (e) {
      console.error('   ❌ Exception thrown:', e);
    }
  }
  console.log();

  // 5. Check function definitions
  console.log('5. Checking function definitions...');
  const { data: funcs, error: funcError } = await supabase.rpc('get_roads_in_bbox', {
    min_lon: 0,
    min_lat: 0,
    max_lon: 0.001,
    max_lat: 0.001,
  });
  
  if (funcError && funcError.message.includes('function')) {
    console.error('   ❌ Function may not exist:', funcError.message);
  } else {
    console.log('   ✅ Function exists and is callable\n');
  }

  console.log('=== Diagnostic Complete ===');
}

diagnose().catch(console.error);
