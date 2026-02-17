#!/usr/bin/env tsx
/**
 * Extract Durham/Oshawa roads from Overture parquet files and upload as GeoJSON
 * 
 * Usage:
 *   export AWS_ACCESS_KEY_ID=xxx
 *   export AWS_SECRET_ACCESS_KEY=xxx
 *   npx tsx scripts/extract-durham-roads-to-s3.ts
 */
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import duckdb from 'duckdb';
import { promisify } from 'util';
import fs from 'fs';

const S3_BUCKET = 'flyr-pro-addresses-2025';
const OUTPUT_KEY = 'overture_extracts/roads/ontario/durham_roads.geojson';

// Durham region tiles (Oshawa area)
// Based on coordinates: -78.67, 43.92 (Oshawa)
const DURHAM_TILES = [
  { y: 136, x: 88 }, { y: 136, x: 89 }, { y: 136, x: 90 },
  { y: 137, x: 88 }, { y: 137, x: 89 }, { y: 137, x: 90 }, { y: 137, x: 91 },
  { y: 138, x: 88 }, { y: 138, x: 89 }, { y: 138, x: 90 },
];

async function extractDurhamRoads() {
  console.log('=== Extracting Durham/Oshawa Roads ===\n');
  
  const s3Client = new S3Client({ region: 'us-east-1' });
  const tempDbPath = '/tmp/durham_roads.duckdb';
  
  // Clean up
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  
  // Initialize DuckDB
  const db = new duckdb.Database(tempDbPath);
  const run = promisify(db.run.bind(db));
  const all = promisify(db.all.bind(db));
  
  console.log('Initializing DuckDB...');
  await run("INSTALL spatial;");
  await run("LOAD spatial;");
  await run("INSTALL httpfs;");
  await run("LOAD httpfs;");
  
  // Create secrets for S3
  await run(`
    CREATE SECRET s3_secret (
      TYPE S3,
      PROVIDER CREDENTIAL_CHAIN
    )
  `);
  
  // Create table
  await run("CREATE TABLE roads (id VARCHAR, class VARCHAR, subclass VARCHAR, geom GEOMETRY);");
  
  // Process each tile
  let totalLoaded = 0;
  for (let i = 0; i < DURHAM_TILES.length; i++) {
    const { y, x } = DURHAM_TILES[i];
    process.stdout.write(`\rProcessing tile ${i + 1}/${DURHAM_TILES.length}: y=${y}, x=${x}...`);
    
    const s3Uri = `s3://${S3_BUCKET}/overture_extracts/roads/release=2026-01-21.0/region=ON/tile_y=${y}/tile_x=${x}/*.parquet`;
    
    try {
      await run(`
        INSERT INTO roads 
        SELECT 
          id,
          class,
          subclass,
          geom
        FROM read_parquet('${s3Uri}', hive_partitioning=1)
        WHERE class NOT IN ('footway', 'cycleway', 'track', 'bridleway', 'path', 'steps')
      `);
      
      const result = await all("SELECT COUNT(*) as cnt FROM roads");
      totalLoaded = result[0].cnt as number;
    } catch (err) {
      // Tile may not exist, skip
    }
  }
  
  console.log(`\n\nTotal roads loaded: ${totalLoaded}`);
  
  if (totalLoaded === 0) {
    console.error('No roads loaded!');
    process.exit(1);
  }
  
  // Export to GeoJSON
  console.log('Exporting to GeoJSON...');
  const geojsonPath = '/tmp/durham_roads.geojson';
  
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
      region: 'Durham/Oshawa',
      extracted_at: new Date().toISOString(),
      total_features: features.length,
    }
  };
  
  const geojsonBuffer = Buffer.from(JSON.stringify(featureCollection));
  console.log(`GeoJSON size: ${(geojsonBuffer.length / 1024 / 1024).toFixed(1)} MB`);
  
  // Upload to S3
  console.log(`Uploading to s3://${S3_BUCKET}/${OUTPUT_KEY}...`);
  
  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: OUTPUT_KEY,
    Body: geojsonBuffer,
    ContentType: 'application/geo+json',
    Metadata: {
      'region': 'durham_oshawa',
      'features': String(features.length),
      'extracted_at': new Date().toISOString(),
    }
  }));
  
  console.log('\n✅ Upload successful!');
  console.log(`File: s3://${S3_BUCKET}/${OUTPUT_KEY}`);
  console.log(`\nSet environment variable:`);
  console.log(`ROADS_S3_KEY=overture_extracts/roads/ontario/durham_roads.geojson`);
  
  // Cleanup
  db.close();
  fs.unlinkSync(tempDbPath);
  fs.unlinkSync(geojsonPath);
}

extractDurhamRoads().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
