#!/usr/bin/env tsx
/**
 * Upload Toronto parcel data to S3 for long-term storage
 * 
 * Usage:
 *   export AWS_ACCESS_KEY_ID=xxx
 *   export AWS_SECRET_ACCESS_KEY=xxx
 *   export AWS_REGION=us-east-1
 *   npx tsx scripts/upload-parcels-to-s3.ts
 */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import path from 'path';

const BUCKET_NAME = 'flyr-pro-addresses-2025';
const PARCEL_FILE = '/Users/danielphillippe/Desktop/FLYR-PRO/data/toronto_parcels.geojson';
const S3_KEY = 'parcels/toronto/toronto_parcels.geojson';

async function uploadParcels() {
  console.log('=== Uploading Toronto Parcels to S3 ===\n');
  
  // Check file exists
  const stats = await stat(PARCEL_FILE);
  console.log(`File size: ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
  
  // Initialize S3 client
  const s3Client = new S3Client({ 
    region: process.env.AWS_REGION || 'us-east-1'
  });
  
  console.log(`Uploading to s3://${BUCKET_NAME}/${S3_KEY}...`);
  
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: S3_KEY,
    Body: createReadStream(PARCEL_FILE),
    ContentType: 'application/geo+json',
    Metadata: {
      'region': 'toronto',
      'parcels-count': '527793',
      'crs': 'EPSG:4326',
      'source': 'doi-10.5683-sp3-1vmjag',
      'upload-date': new Date().toISOString()
    }
  });
  
  try {
    const response = await s3Client.send(command);
    console.log('\n✅ Upload successful!');
    console.log(`ETag: ${response.ETag}`);
    console.log(`\nFile URL:`);
    console.log(`https://${BUCKET_NAME}.s3.amazonaws.com/${S3_KEY}`);
    console.log(`\nTo use in campaigns, run:`);
    console.log(`npx tsx scripts/load-parcels-for-campaign.ts <campaign-id> <bbox>`);
  } catch (error) {
    console.error('\n❌ Upload failed:', error);
    process.exit(1);
  }
}

uploadParcels();
