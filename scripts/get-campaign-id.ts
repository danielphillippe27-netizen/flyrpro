#!/usr/bin/env tsx
/**
 * Quick script to get the first available campaign ID
 */

import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://kfnsnwqylsdsbgnwgxva.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_DB_PASSWORD || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('❌ Missing Supabase key');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function getCampaignId() {
  try {
    const { data, error } = await supabase
      .from('campaigns')
      .select('id')
      .limit(1)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Error:', error.message);
      process.exit(1);
    }

    if (!data || data.length === 0) {
      console.log('❌ No campaigns found');
      process.exit(1);
    }

    console.log(data[0].id);
    return data[0].id;
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

getCampaignId();
