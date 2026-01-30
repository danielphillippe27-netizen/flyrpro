#!/usr/bin/env tsx
/**
 * Get campaign IDs using the same database connection method as export script
 */

import * as dotenv from 'dotenv';
import duckdb from 'duckdb';

dotenv.config({ path: '.env.local' });
dotenv.config();

const motherDuckToken = process.env.MOTHERDUCK_TOKEN;
const supabasePassword = process.env.SUPABASE_DB_PASSWORD || process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kfnsnwqylsdsbgnwgxva.supabase.co';

if (!motherDuckToken || !supabasePassword) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

function getSupabaseHost(): string {
  const url = new URL(supabaseUrl);
  const hostname = url.hostname;
  if (hostname.includes('supabase.co')) {
    return `db.${hostname}`;
  }
  return hostname;
}

async function getCampaigns() {
  const db = new duckdb.Database(`md:?motherduck_token=${motherDuckToken}`);
  const conn = db.connect();

  // Load extensions
  await new Promise<void>((resolve, reject) => {
    conn.exec('INSTALL spatial; LOAD spatial; INSTALL postgres; LOAD postgres;', (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  const supabaseHost = getSupabaseHost();
  const attachSQL = `
    ATTACH 'host=${supabaseHost} user=postgres password=${supabasePassword} dbname=postgres port=5432 sslmode=require' 
    AS supabase (TYPE POSTGRES);
  `;

  await new Promise<void>((resolve, reject) => {
    conn.exec(attachSQL, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  const query = `
    SELECT id, COALESCE(title, name) AS name, created_at
    FROM supabase.campaigns
    ORDER BY created_at DESC
    LIMIT 10
  `;

  return new Promise<any[]>((resolve, reject) => {
    conn.all(query, (err, rows: any[]) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

getCampaigns()
  .then((campaigns) => {
    if (campaigns.length === 0) {
      console.log('❌ No campaigns found');
      process.exit(1);
    }
    console.log('\n📋 Available campaigns:\n');
    campaigns.forEach((camp, idx) => {
      console.log(`${idx + 1}. ${camp.name || 'Unnamed'} (${camp.id})`);
    });
    console.log(`\n✅ Using first campaign: ${campaigns[0].id}\n`);
    console.log(campaigns[0].id);
  })
  .catch((error) => {
    console.error('❌ Error:', error.message);
    process.exit(1);
  });
