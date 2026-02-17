#!/usr/bin/env tsx
/**
 * Extract Ontario roads from Overture S3 parquet files and upload as GeoJSON
 * for snap-to-roads functionality.
 * 
 * Usage:
 *   export AWS_ACCESS_KEY_ID=xxx
 *   export AWS_SECRET_ACCESS_KEY=xxx
 *   npx tsx scripts/extract-ontario-roads-to-s3.ts
 */
import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import duckdb from 'duckdb';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const SOURCE_BUCKET = 'flyr-pro-addresses-2025';
const SOURCE_PREFIX = 'overture_extracts/roads/release=2026-01-21.0/region=ON/';
const OUTPUT_KEY = 'overture_extracts/roads/ontario/roads.geojson';
const TEMP_DB = '/tmp/ontario_roads.duckdb';

async function extractOntarioRoads() {
  console.log('=== Extracting Ontario Roads to S3 ===\n');
  
  // Clean up temp file
  if (fs.existsSync(TEMP_DB)) {
    fs.unlinkSync(TEMP_DB);
  }
  
  // Initialize S3
  const s3Client = new S3Client({ region: 'us-east-1' });
  
  // List all road parquet files for Ontario
  console.log('Listing road files in S3...');
  const files: string[] = [];
  let continuationToken: string | undefined;
  
  do {
    const listCommand = new ListObjectsV2Command({
      Bucket: SOURCE_BUCKET,
      Prefix: SOURCE_PREFIX,
      ContinuationToken: continuationToken,
    });
    
    const response = await s3Client.send(listCommand);
    for (const obj of response.Contents || []) {
      if (obj.Key?.endsWith('.parquet')) {
        files.push(obj.Key);
      }
    }
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
  
  console.log(`Found ${files.length} parquet files`);
  
  if (files.length === 0) {
    console.error('No road files found!');
    process.exit(1);
  }
  
  // Initialize DuckDB
  const db = new duckdb.Database(TEMP_DB);
  const run = promisify(db.run.bind(db));
  const all = promisify(db.all.bind(db));
  
  // Install and load spatial extension
  console.log('Initializing DuckDB...');
  await run("INSTALL spatial;");
  await run("LOAD spatial;");
  await run("INSTALL httpfs;");
  await run("LOAD httpfs;");
  
  // Create table for roads
  await run("CREATE TABLE roads (id VARCHAR, class VARCHAR, subclass VARCHAR, geom GEOMETRY);");
  
  // Process each file
  let totalRows = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const s3Uri = `s3://${SOURCE_BUCKET}/${file}`;
    
    process.stdout.write(`\rProcessing file ${i + 1}/${files.length}: ${file.split('/').pop()}...`);
    
    try {
      // Read parquet and insert
      await run(`
        INSERT INTO roads 
        SELECT 
          id,
          class,
          subclass,
          geom
        FROM read_parquet('${s3Uri}')
        WHERE class NOT IN ('footway', 'cycleway', 'track', 'bridleway', 'path', 'steps')
      `);
      
      const result = await all("SELECT COUNT(*) as cnt FROM roads");
      totalRows = result[0].cnt as number;
    } catch (err) {
      console.warn(`\nWarning: Failed to process ${file}:`, (err as Error).message);
    }
  }
  
  console.log(`\n\nTotal roads loaded: ${totalRows}`);
  
  if (totalRows === 0) {
    console.error('No roads loaded!');
    process.exit(1);
  }
  
  // Export to GeoJSON
  console.log('Exporting to GeoJSON...');
  const geojsonPath = '/tmp/ontario_roads.geojson';
  
  await run(`
    COPY (
      SELECT 
        json_object(
          'type', 'Feature',
          'geometry', ST_AsGeoJSON(geom)::JSON,
          'properties', json_object('class', class, 'subclass', subclass, 'id', id)
        ) as feature
      FROM roads
    ) TO '${geojsonPath}' (FORMAT JSON, ARRAY true)
  `);
  
  // Read and wrap as FeatureCollection
  const features = fs.readFileSync(geojsonPath, 'utf-8')
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
  
  const featureCollection = {
    type: 'FeatureCollection',
    features: features,
    metadata: {
      source: 'Overture Maps',
      region: 'Ontario',
      extracted_at: new Date().toISOString(),
      total_features: features.length,
    }
  };
  
  const geojsonBuffer = Buffer.from(JSON.stringify(featureCollection));
  console.log(`GeoJSON size: ${(geojsonBuffer.length / 1024 / 1024).toFixed(1)} MB`);
  
  // Upload to S3
  console.log(`Uploading to s3://flyr-pro-addresses-2025/${OUTPUT_KEY}...`);
  
  const putCommand = new PutObjectCommand({
    Bucket: 'flyr-pro-addresses-2025',
    Key: OUTPUT_KEY,
    Body: geojsonBuffer,
    ContentType: 'application/geo+json',
    Metadata: {
      'region': 'ontario',
      'features': String(features.length),
      'extracted_at': new Date().toISOString(),
    }
  });
  
  await s3Client.send(putCommand);
  
  console.log('\n✅ Upload successful!');
  console.log(`\nFile URL:`);
  console.log(`https://flyr-pro-addresses-2025.s3.amazonaws.com/${OUTPUT_KEY}`);
  console.log(`\nSnap to roads will now use S3 as the primary source!`);
  
  // Cleanup
  db.close();
  fs.unlinkSync(TEMP_DB);
  fs.unlinkSync(geojsonPath);
}

extractOntarioRoads().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
