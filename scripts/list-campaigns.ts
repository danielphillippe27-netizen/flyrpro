#!/usr/bin/env tsx
/**
 * List existing campaigns in the database
 * Usage: npx tsx scripts/list-campaigns.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables:');
  console.error('   NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL');
  console.error('   SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function listCampaigns() {
  try {
    // Query only columns that definitely exist (id and created_at)
    // Other columns may not exist depending on migration state
    const { data: campaigns, error } = await supabase
      .from('campaigns')
      .select('id, created_at')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      throw error;
    }

    if (!campaigns || campaigns.length === 0) {
      console.log('No campaigns found in the database.');
      console.log('');
      console.log('To create a campaign, use the web interface or API.');
      process.exit(0);
    }

    console.log(`Found ${campaigns.length} campaign(s):\n`);
    
    campaigns.forEach((campaign, index) => {
      console.log(`${index + 1}. Campaign`);
      console.log(`   ID: ${campaign.id}`);
      console.log(`   Created: ${new Date(campaign.created_at).toLocaleString()}`);
      console.log('');
    });

    console.log('To use a campaign for E2E testing, run:');
    console.log(`   export CAMPAIGN_ID=${campaigns[0].id}`);
    console.log('   npx tsx scripts/e2e-overture-smoke.ts');
    console.log('');

  } catch (error) {
    console.error('❌ Error listing campaigns:');
    if (error instanceof Error) {
      console.error('   Message:', error.message);
      console.error('   Stack:', error.stack);
    } else {
      console.error('   Error:', JSON.stringify(error, null, 2));
    }
    process.exit(1);
  }
}

listCampaigns();
