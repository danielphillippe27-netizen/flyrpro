#!/usr/bin/env node

const fs = require('fs');
const https = require('https');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

async function applyMigration() {
  console.log('Reading migration file...');
  const sql = fs.readFileSync('supabase/migrations/20260217310000_add_timeframe_to_leaderboard.sql', 'utf8');
  
  console.log('Applying migration via Supabase Management API...\n');
  
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)/)[1];
  const url = `https://${projectRef}.supabase.co/rest/v1/rpc/query`;
  
  const postData = JSON.stringify({ query: sql });
  
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
      'apikey': supabaseServiceKey,
      'Authorization': `Bearer ${supabaseServiceKey}`,
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('✅ Migration applied successfully!');
          resolve();
        } else {
          console.error('❌ Migration failed:', res.statusCode, data);
          reject(new Error(data));
        }
      });
    });
    
    req.on('error', (error) => {
      console.error('❌ Request error:', error.message);
      reject(error);
    });
    
    req.write(postData);
    req.end();
  });
}

applyMigration().catch(() => process.exit(1));
