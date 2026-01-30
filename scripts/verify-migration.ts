#!/usr/bin/env tsx
/**
 * Verify that buildings.campaign_id migration has been applied
 * Usage: npx tsx scripts/verify-migration.ts
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

async function verifyMigration() {
  try {
    // Query information_schema to check if campaign_id column exists
    const { data, error } = await supabase.rpc('exec_sql', {
      sql_query: `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'buildings' 
          AND column_name = 'campaign_id';
      `,
    });

    // If RPC doesn't exist, try direct query via REST API
    if (error) {
      // Alternative: Query using a SELECT statement on the buildings table
      // We'll try to select campaign_id to see if it exists
      const { data: testData, error: testError } = await supabase
        .from('buildings')
        .select('campaign_id')
        .limit(1);

      if (testError) {
        // Check if error is about missing column
        if (testError.message.includes('campaign_id') || testError.message.includes('column')) {
          console.log('❌ Migration not applied: campaign_id column is missing from buildings table');
          console.log('');
          console.log('To apply the migration, run:');
          console.log('   ./scripts/run-migration-psql.sh 20251207000004_add_campaign_id_to_buildings.sql');
          console.log('');
          console.log('Or manually execute the SQL file in Supabase SQL Editor:');
          console.log('   supabase/migrations/20251207000004_add_campaign_id_to_buildings.sql');
          process.exit(1);
        } else {
          // Other error (table might not exist, etc.)
          console.error('❌ Error checking migration status:', testError.message);
          process.exit(1);
        }
      } else {
        // Column exists - migration is applied
        console.log('✅ Migration verified: campaign_id column is present on buildings table');
        process.exit(0);
      }
    } else {
      // RPC worked, check results
      if (data && Array.isArray(data) && data.length > 0) {
        console.log('✅ Migration verified: campaign_id column is present on buildings table');
        process.exit(0);
      } else {
        console.log('❌ Migration not applied: campaign_id column is missing from buildings table');
        console.log('');
        console.log('To apply the migration, run:');
        console.log('   ./scripts/run-migration-psql.sh 20251207000004_add_campaign_id_to_buildings.sql');
        console.log('');
        console.log('Or manually execute the SQL file in Supabase SQL Editor:');
        console.log('   supabase/migrations/20251207000004_add_campaign_id_to_buildings.sql');
        process.exit(1);
      }
    }
  } catch (error) {
    console.error('❌ Error verifying migration:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

verifyMigration();
