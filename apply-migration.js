#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials');
  console.error('Need: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function applyMigration() {
  console.log('Reading migration file...');
  const sql = fs.readFileSync('supabase/migrations/20260217310000_add_timeframe_to_leaderboard.sql', 'utf8');
  
  console.log('Applying migration to add timeframe parameter...\n');
  
  const { data, error } = await supabase.rpc('exec_sql', { sql });
  
  if (error) {
    console.error('❌ Migration failed:', error.message);
    
    // Try alternative approach using the REST API
    console.log('\nTrying alternative approach...');
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({ query: sql }),
    });
    
    if (!response.ok) {
      console.error('Alternative approach also failed');
      process.exit(1);
    }
  }
  
  console.log('✅ Migration applied successfully!');
  
  // Test the updated function
  console.log('\nTesting updated function with timeframe parameter...');
  const { data: testData, error: testError } = await supabase.rpc('get_leaderboard', {
    sort_by: 'flyers',
    limit_count: 5,
    offset_count: 0,
    timeframe: 'week',
  });
  
  if (testError) {
    console.error('❌ Test failed:', testError.message);
  } else {
    console.log('✅ Test successful! Found', testData?.length || 0, 'entries for "week" timeframe');
    if (testData && testData.length > 0) {
      console.log('Top entry:', testData[0].name, '-', testData[0].flyers, 'flyers');
    }
  }
}

applyMigration();
