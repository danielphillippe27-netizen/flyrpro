import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import * as dotenv from 'dotenv';
import path from 'path';

const result = dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });
if (result.error) dotenv.config();

const s3 = new S3Client({ 
  region: process.env.AWS_REGION || 'us-east-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
  }
});

async function peep() {
  const s3Res = await s3.send(new GetObjectCommand({ 
    Bucket: 'flyr-pro-addresses-2025', 
    Key: 'gold-standard/canada/ontario/toronto/addresses.geojson' 
  }));
  const raw = await s3Res.Body?.transformToString();
  const geojson = JSON.parse(raw || '{}');
  
  console.log('=== SAMPLING ADDRESSES ===\n');
  
  // Check first 20 features in detail
  console.log('First 20 features - ALL properties:');
  for (let i = 0; i < 20; i++) {
    console.log(`\n--- Feature ${i} ---`);
    console.log(JSON.stringify(geojson.features[i].properties, null, 2));
  }
  
  // Check middle of file
  const midIndex = Math.floor(geojson.features.length / 2);
  console.log(`\n\n=== MIDDLE OF FILE (index ${midIndex}) ===`);
  console.log(JSON.stringify(geojson.features[midIndex].properties, null, 2));
  
  // Check end of file
  console.log(`\n\n=== END OF FILE (last 3 features) ===`);
  for (let i = geojson.features.length - 3; i < geojson.features.length; i++) {
    console.log(`\n--- Feature ${i} ---`);
    console.log(JSON.stringify(geojson.features[i].properties, null, 2));
  }
  
  // Count non-empty street_names
  const withStreet = geojson.features.filter((f: any) => f.properties.street_name && f.properties.street_name.trim() !== '');
  console.log(`\n\n=== SUMMARY ===`);
  console.log(`Total features: ${geojson.features.length.toLocaleString()}`);
  console.log(`Features with non-empty street_name: ${withStreet.length.toLocaleString()}`);
}

peep();
