#!/usr/bin/env tsx
/**
 * Smoke Test for Generate Address List Endpoint
 * 
 * Tests the generate-address-list endpoint that:
 * 1. Geocodes a starting address
 * 2. Queries Overture for nearest addresses
 * 3. Inserts addresses into campaign_addresses
 * 
 * Usage: npx tsx scripts/generate-address-list-smoke.ts
 * 
 * Environment variables:
 * - NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL (required)
 * - SUPABASE_SERVICE_ROLE_KEY (required)
 * - CAMPAIGN_ID (required - UUID of existing campaign)
 * - STARTING_ADDRESS (required - address to start from)
 * - COUNT (optional - number of addresses to generate, default 10)
 * - API_BASE_URL (optional - defaults to http://localhost:3000)
 */

import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const campaignId = process.env.CAMPAIGN_ID;
const startingAddress = process.env.STARTING_ADDRESS;
const count = process.env.COUNT ? parseInt(process.env.COUNT, 10) : 10;
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

if (!startingAddress) {
  console.error('❌ Missing required environment variable: STARTING_ADDRESS');
  console.error('   Please set STARTING_ADDRESS to a valid address');
  console.error('   Example: export STARTING_ADDRESS="123 Main St, San Francisco, CA"');
  process.exit(1);
}

async function testGenerateAddressList() {
  console.log('🚀 Testing Generate Address List Endpoint...');
  console.log(`   Campaign ID: ${campaignId}`);
  console.log(`   Starting Address: ${startingAddress}`);
  console.log(`   Count: ${count}`);
  console.log(`   API Base URL: ${apiBaseUrl}`);
  console.log('');

  try {
    const response = await fetch(`${apiBaseUrl}/api/campaigns/generate-address-list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        campaign_id: campaignId,
        starting_address: startingAddress,
        count: count,
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
      throw new Error(`Request failed: ${errorMessage}`);
    }

    const result = await response.json();
    
    console.log('✅ Request successful!');
    console.log('');
    console.log(`   Inserted Count: ${result.inserted_count || 0}`);
    console.log('');

    if (result.preview && result.preview.length > 0) {
      console.log('   Preview (first 3 addresses):');
      result.preview.slice(0, 3).forEach((addr: any, index: number) => {
        console.log(`   ${index + 1}. ${addr.formatted || 'N/A'}`);
        if (addr.postal_code) {
          console.log(`      Postal Code: ${addr.postal_code}`);
        }
        if (addr.source_id) {
          console.log(`      Source ID: ${addr.source_id}`);
        }
      });
    } else {
      console.log('   No addresses in preview');
    }

    console.log('');
    console.log('✅ Smoke Test PASSED');
    console.log('');
    console.log('Summary:');
    console.log(`   - Inserted ${result.inserted_count || 0} addresses`);
    console.log(`   - Campaign ID: ${campaignId}`);
    console.log('');
    console.log('Next steps:');
    console.log(`   - Check Supabase campaign_addresses table: SELECT * FROM campaign_addresses WHERE campaign_id = '${campaignId}'`);
    console.log('   - Verify addresses have correct geometry (geom column)');
    console.log('   - Verify source_id values are set for deduplication');

    process.exit(0);
  } catch (error) {
    console.error('');
    console.error('❌ Smoke Test FAILED');
    console.error('   Error:', error instanceof Error ? error.message : String(error));
    console.error('');

    if (error instanceof Error && error.message.includes('fetch')) {
      console.error('   Make sure your Next.js dev server is running:');
      console.error('   npm run dev');
      console.error('');
    }

    process.exit(1);
  }
}

// Check if API is reachable
async function checkApiHealth() {
  try {
    const response = await fetch(`${apiBaseUrl}/api/health`).catch(() => null);
    // Health endpoint might not exist, so we'll just try the actual endpoint
    return true;
  } catch {
    // API might not be running, but we'll try anyway
    console.warn(`⚠️  Warning: Could not reach API at ${apiBaseUrl}`);
    console.warn('   Make sure your Next.js dev server is running (npm run dev)');
    return false;
  }
}

// Run the test
console.log('🚀 Starting Generate Address List Smoke Test...');
console.log('');

checkApiHealth().then(() => {
  testGenerateAddressList();
});
