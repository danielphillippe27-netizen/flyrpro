#!/usr/bin/env tsx
/**
 * Upload PMTiles file to Supabase Storage
 * Usage: npx tsx scripts/upload-pmtiles.ts [path-to-buildings.pmtiles]
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://kfnsnwqylsdsbgnwgxva.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_DB_PASSWORD;

if (!supabaseServiceKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY or SUPABASE_DB_PASSWORD is required');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const filePath = process.argv[2] || 'buildings.pmtiles';
const bucketName = 'map-tiles';
const fileName = 'buildings.pmtiles';

async function uploadPmtiles() {
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    console.error('   Usage: npx tsx scripts/upload-pmtiles.ts [path-to-buildings.pmtiles]');
    process.exit(1);
  }

  const file = fs.readFileSync(filePath);
  const fileSizeMB = (file.length / (1024 * 1024)).toFixed(2);
  
  console.log(`📤 Uploading ${filePath} (${fileSizeMB} MB) to Supabase Storage...`);
  console.log(`   Bucket: ${bucketName}`);
  console.log(`   File: ${fileName}`);

  try {
    // Upload file (with upsert to overwrite if exists)
    const { data, error } = await supabase.storage
      .from(bucketName)
      .upload(fileName, file, {
        contentType: 'application/x-protobuf',
        upsert: true, // Overwrite if exists
      });

    if (error) {
      // If bucket doesn't exist, try to create it
      if (error.message.includes('Bucket not found') || error.message.includes('not found')) {
        console.log('⚠️  Bucket not found. Attempting to create it...');
        console.log('   Note: You may need to create the bucket manually in Supabase Dashboard');
        console.log('   Go to Storage → New bucket → Name: map-tiles → Public bucket');
        process.exit(1);
      }
      throw error;
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from(bucketName)
      .getPublicUrl(fileName);

    console.log('');
    console.log('✅ Upload successful!');
    console.log('');
    console.log('📋 Public URL:');
    console.log(`   ${publicUrl}`);
    console.log('');
    console.log('📝 Next steps:');
    console.log('   1. Verify the file is accessible at the URL above');
    console.log('   2. The frontend (BuildingLayers.tsx) will automatically use this URL');
    console.log('   3. If you need a custom URL, set NEXT_PUBLIC_PMTILES_URL in .env.local');
  } catch (error: any) {
    console.error('❌ Upload failed:', error.message);
    if (error.message.includes('new row violates row-level security')) {
      console.error('');
      console.error('💡 Tip: Make sure the map-tiles bucket exists and is set to Public');
      console.error('   Create it in Supabase Dashboard: Storage → New bucket → map-tiles → Public');
    }
    process.exit(1);
  }
}

uploadPmtiles();
