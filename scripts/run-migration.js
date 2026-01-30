#!/usr/bin/env node
/**
 * Run Supabase SQL migration locally using pg library
 * Usage: node scripts/run-migration.js [migration-file]
 */

const { readFileSync } = require('fs');
const { join } = require('path');
const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

// Get DATABASE_URL or construct from Supabase URL
let databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (supabaseUrl) {
    // Extract project ref from URL
    const match = supabaseUrl.match(/https?:\/\/([^.]+)\.supabase\.co/);
    if (match) {
      const projectRef = match[1];
      console.error('❌ DATABASE_URL is not set.');
      console.error('');
      console.error('Please set DATABASE_URL in your .env.local file:');
      console.error('');
      console.error(`  DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.${projectRef}.supabase.co:5432/postgres`);
      console.error('');
      console.error('Get your password from: Supabase Dashboard > Settings > Database > Database password');
      process.exit(1);
    }
  }
  console.error('❌ DATABASE_URL is not set and could not be inferred from Supabase URL');
  process.exit(1);
}

const migrationFile = process.argv[2] || '20251207000004_add_campaign_id_to_buildings.sql';
const migrationPath = join(process.cwd(), 'supabase', 'migrations', migrationFile);

console.log(`📄 Reading migration: ${migrationPath}`);

let sql;
try {
  sql = readFileSync(migrationPath, 'utf-8');
} catch (error) {
  console.error(`❌ Failed to read migration file: ${error.message}`);
  process.exit(1);
}

if (!sql.trim()) {
  console.error('❌ Migration file is empty');
  process.exit(1);
}

console.log(`\n🚀 Executing migration...\n`);

const client = new Client({
  connectionString: databaseUrl,
});

async function runMigration() {
  try {
    await client.connect();
    console.log('✅ Connected to database\n');
    
    // Execute the SQL
    await client.query(sql);
    
    console.log('✅ Migration completed successfully!\n');
  } catch (error) {
    console.error('❌ Migration failed:\n');
    console.error(error.message);
    if (error.position) {
      console.error(`\nError at position: ${error.position}`);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch((error) => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

