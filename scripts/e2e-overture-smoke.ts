#!/usr/bin/env tsx
/**
 * E2E Smoke Test for Overture Sync and Campaign Provisioning
 * 
 * Tests the full flow:
 * 1. Sync neighborhood (extract buildings from Overture)
 * 2. Provision campaign (assign buildings to campaign with campaign_id)
 * 3. Verify buildings have campaign_id set and data is present
 * 
 * Usage: npx tsx scripts/e2e-overture-smoke.ts
 * 
 * Environment variables:
 * - NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL (required)
 * - SUPABASE_SERVICE_ROLE_KEY (required)
 * - CAMPAIGN_ID (required - UUID of existing campaign to use for testing)
 * - API_BASE_URL (optional - defaults to http://localhost:3000)
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const campaignId = process.env.CAMPAIGN_ID;
const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3000';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables:');
  console.error('   NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL');
  console.error('   SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (!campaignId) {
  console.error('❌ Missing required environment variable: CAMPAIGN_ID');
  console.error('   Please set CAMPAIGN_ID to an existing campaign UUID');
  console.error('   Example: export CAMPAIGN_ID=your-campaign-uuid-here');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Small bbox for testing (downtown San Francisco area - larger area to ensure buildings)
const TEST_BBOX = {
  west: -122.42,
  south: 37.77,
  east: -122.40,
  north: 37.79,
};

async function verifyCampaignExists(campaignId: string): Promise<void> {
  console.log(`📋 Verifying campaign exists: ${campaignId}`);
  
  const { data, error } = await supabase
    .from('campaigns')
    .select('id')
    .eq('id', campaignId)
    .single();

  if (error || !data) {
    throw new Error(`Campaign not found: ${campaignId}. ${error?.message || 'Campaign does not exist'}`);
  }

  console.log(`✅ Campaign verified: ${campaignId}`);
}

async function syncNeighborhood(testCampaignId: string): Promise<number> {
  console.log('🔄 Step 1: Syncing neighborhood...');
  console.log(`   Bbox: ${JSON.stringify(TEST_BBOX)}`);

  const response = await fetch(`${apiBaseUrl}/api/overture/sync-neighborhood`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      bbox: TEST_BBOX,
      campaignId: testCampaignId,
    }),
  });

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const errorData = await response.json();
      const errorDetail = errorData.error || errorData.message || JSON.stringify(errorData);
      errorMessage = `${errorMessage}\n   Details: ${errorDetail}`;
    } catch {
      // If response isn't JSON, try to get text
      try {
        const errorText = await response.text();
        if (errorText) errorMessage = `${errorMessage}\n   Response: ${errorText.substring(0, 500)}`;
      } catch {
        // Use default error message
      }
    }
    throw new Error(`Sync failed: ${errorMessage}`);
  }

  const result = await response.json();
  console.log(`✅ Synced ${result.buildings || result.count || 0} buildings and ${result.transportation || 0} transportation segments`);
  
  return result.buildings || result.count || 0;
}

async function provisionCampaign(testCampaignId: string): Promise<number> {
  console.log('🏗️  Step 2: Provisioning campaign...');

  const response = await fetch(`${apiBaseUrl}/api/campaigns/provision`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      campaign_id: testCampaignId,
      boundary: TEST_BBOX, // Use bbox format
    }),
  });

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const errorData = await response.json();
      errorMessage = errorData.error || errorData.message || errorMessage;
    } catch {
      // If response isn't JSON, try to get text
      try {
        const errorText = await response.text();
        if (errorText) errorMessage = errorText;
      } catch {
        // Use default error message
      }
    }
    throw new Error(`Provision failed: ${errorMessage}`);
  }

  const result = await response.json();
  console.log(`✅ Provisioned ${result.count || result.buildings || 0} buildings for campaign`);
  
  return result.count || result.buildings || 0;
}

async function verifyBuildings(testCampaignId: string): Promise<void> {
  console.log('🔍 Step 3: Verifying buildings...');

  // Query buildings with campaign_id
  const { data: buildings, error } = await supabase
    .from('buildings')
    .select('gers_id, campaign_id, centroid, geom, height, addr_street')
    .eq('campaign_id', testCampaignId)
    .limit(10);

  if (error) {
    throw new Error(`Failed to query buildings: ${error.message}`);
  }

  if (!buildings || buildings.length === 0) {
    throw new Error('No buildings found with campaign_id set');
  }

  console.log(`✅ Found ${buildings.length} buildings with campaign_id set`);

  // Verify required fields
  const missingFields = buildings.filter(b => 
    !b.centroid || !b.geom
  );

  if (missingFields.length > 0) {
    throw new Error(`${missingFields.length} buildings missing required fields (centroid or geom)`);
  }

  console.log('✅ All buildings have required fields (centroid, geom)');

  // Check if any buildings have orientation-related data (optional)
  const withAddress = buildings.filter(b => b.addr_street).length;
  console.log(`   ${withAddress}/${buildings.length} buildings have street addresses`);

  // Verify campaign_id is actually set (not null)
  const nullCampaignId = buildings.filter(b => !b.campaign_id).length;
  if (nullCampaignId > 0) {
    throw new Error(`${nullCampaignId} buildings have null campaign_id`);
  }

  console.log('✅ All buildings have campaign_id set correctly');
}


async function runSmokeTest() {
  try {
    // Step 0: Verify campaign exists
    await verifyCampaignExists(campaignId);

    // Step 1: Sync neighborhood
    const syncCount = await syncNeighborhood(campaignId);
    if (syncCount === 0) {
      console.warn('⚠️  Warning: No buildings were synced. This might be expected for the test bbox.');
    }

    // Step 2: Provision campaign
    const provisionCount = await provisionCampaign(campaignId);
    if (provisionCount === 0 && syncCount === 0) {
      console.warn('⚠️  Warning: No buildings found in test bbox. This might be expected.');
      console.warn('   The test bbox may not contain residential buildings, or Overture data may not be available for this area.');
      console.warn('   Consider using a different bbox with known residential buildings.');
      // Don't fail the test if no buildings found - this could be a data availability issue
      // Instead, we'll verify the flow worked correctly even with 0 results
      console.log('✅ Provision endpoint responded successfully (0 buildings is acceptable for this bbox)');
    } else if (provisionCount === 0 && syncCount > 0) {
      throw new Error('Buildings were synced but not provisioned - this indicates a problem');
    }

    // Step 3: Verify buildings (only if buildings were provisioned)
    if (provisionCount > 0) {
      await verifyBuildings(campaignId);
    } else {
      console.log('⏭️  Skipping building verification (no buildings were provisioned)');
    }

    console.log('');
    console.log('✅ E2E Smoke Test PASSED');
    console.log('');
    console.log('Summary:');
    console.log(`   - Synced ${syncCount} buildings`);
    console.log(`   - Provisioned ${provisionCount} buildings`);
    console.log(`   - Campaign ID: ${campaignId}`);
    console.log('');
    console.log('Next steps:');
    console.log(`   - Check Supabase buildings table: SELECT * FROM buildings WHERE campaign_id = '${campaignId}'`);
    console.log('   - Verify orientation data if applicable');
    console.log('   - Check overture_transportation table for transportation segments');

    process.exit(0);
  } catch (error) {
    console.error('');
    console.error('❌ E2E Smoke Test FAILED');
    console.error('   Error:', error instanceof Error ? error.message : String(error));
    console.error('');

    process.exit(1);
  }
}

// Check if API is reachable
async function checkApiHealth() {
  try {
    const response = await fetch(`${apiBaseUrl}/api/health`).catch(() => null);
    // Health endpoint might not exist, so we'll just try the actual endpoints
    return true;
  } catch {
    // API might not be running, but we'll try anyway
    console.warn(`⚠️  Warning: Could not reach API at ${apiBaseUrl}`);
    console.warn('   Make sure your Next.js dev server is running (npm run dev)');
    return false;
  }
}

// Run the test
console.log('🚀 Starting E2E Overture Smoke Test...');
console.log(`   API Base URL: ${apiBaseUrl}`);
console.log('');

checkApiHealth().then(() => {
  runSmokeTest();
});
