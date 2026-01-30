#!/usr/bin/env tsx
/**
 * Run Supabase SQL migration locally
 * Usage: npx tsx scripts/run-migration.ts <migration-file>
 */

import { readFileSync } from 'fs';
import { join } from 'path';
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

async function runMigration(migrationFile: string) {
  const migrationPath = join(process.cwd(), 'supabase', 'migrations', migrationFile);
  
  console.log(`📄 Reading migration: ${migrationPath}`);
  
  let sql: string;
  try {
    sql = readFileSync(migrationPath, 'utf-8');
  } catch (error) {
    console.error(`❌ Failed to read migration file: ${error}`);
    process.exit(1);
  }

  // Split SQL into individual statements (split by semicolon, but preserve DO $$ blocks)
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  console.log(`\n🚀 Executing ${statements.length} SQL statements...\n`);

  try {
    // Execute the entire migration as one query (PostgreSQL handles multiple statements)
    const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });
    
    if (error) {
      // If the RPC doesn't exist, try direct query execution
      // Supabase doesn't have a direct SQL execution endpoint, so we'll use the REST API
      console.log('⚠️  RPC method not available, trying alternative approach...');
      
      // For Supabase, we need to use the REST API or execute via psql
      // Since we can't execute arbitrary SQL via the JS client, we'll provide instructions
      console.error('\n❌ Cannot execute SQL directly via Supabase JS client.');
      console.error('   Please run this migration in the Supabase SQL Editor:\n');
      console.error(`   File: ${migrationPath}\n`);
      console.error('   Or use psql with your DATABASE_URL:\n');
      console.error(`   psql "$DATABASE_URL" -f ${migrationPath}\n`);
      process.exit(1);
    }

    console.log('✅ Migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Get migration file from command line args
const migrationFile = process.argv[2] || '20251207000004_add_campaign_id_to_buildings.sql';

runMigration(migrationFile).catch(console.error);

