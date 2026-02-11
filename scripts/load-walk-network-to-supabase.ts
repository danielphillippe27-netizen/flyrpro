/**
 * Load Overture Walk Network into Supabase
 * 
 * This script loads pedestrian walk network data from Overture Maps S3
 * into the Supabase overture_transportation table.
 * 
 * Approach: DuckDB exports to CSV with WKT, then COPY to Supabase via SQL Editor or psql
 * 
 * Run with: npx tsx scripts/load-walk-network-to-supabase.ts
 * 
 * Environment Variables:
 *   - OVERTURE_RELEASE: Overture release (default: 2025-12-17.0)
 *   - BBOX_WEST, BBOX_EAST, BBOX_SOUTH, BBOX_NORTH: Optional bounding box
 * 
 * Options:
 *   --include-road-fallback: Include residential/service roads
 *   --output-dir: Output directory (default: ./data)
 *   --generate-sql-only: Only generate SQL, don't export data
 * 
 * Examples:
 *   # Export walk network to CSV
 *   npx tsx scripts/load-walk-network-to-supabase.ts
 * 
 *   # With bounding box (NYC area)
 *   BBOX_WEST=-74.5 BBOX_EAST=-73.5 BBOX_SOUTH=40.5 BBOX_NORTH=41.0 npx tsx scripts/load-walk-network-to-supabase.ts
 * 
 *   # Generate SQL for Supabase SQL Editor
 *   npx tsx scripts/load-walk-network-to-supabase.ts --generate-sql-only
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import duckdb from 'duckdb';
import * as fs from 'fs';
import * as path from 'path';

interface Options {
  overtureRelease: string;
  overtureS3Region: string;
  outputDir: string;
  classes: string[];
  bbox: { west: number; east: number; south: number; north: number } | null;
  generateSqlOnly: boolean;
}

async function main() {
  console.log('=== Overture Walk Network Loader ===\n');

  // Parse arguments
  const args = process.argv.slice(2);
  const includeRoadFallback = args.includes('--include-road-fallback');
  const generateSqlOnly = args.includes('--generate-sql-only');
  const outputDirArg = args.find(arg => arg.startsWith('--output-dir='));
  const outputDir = outputDirArg ? outputDirArg.split('=')[1] : './data';

  const overtureRelease = process.env.OVERTURE_RELEASE || '2025-12-17.0';
  const overtureS3Region = process.env.OVERTURE_S3_REGION || 'us-west-2';

  // Parse bounding box
  const bbox = {
    west: process.env.BBOX_WEST ? parseFloat(process.env.BBOX_WEST) : null,
    east: process.env.BBOX_EAST ? parseFloat(process.env.BBOX_EAST) : null,
    south: process.env.BBOX_SOUTH ? parseFloat(process.env.BBOX_SOUTH) : null,
    north: process.env.BBOX_NORTH ? parseFloat(process.env.BBOX_NORTH) : null,
  };
  const hasBbox = bbox.west !== null && bbox.east !== null && bbox.south !== null && bbox.north !== null;

  // Build class list
  const walkClasses = ['footway', 'path', 'pedestrian', 'steps'];
  const roadClasses = ['residential', 'service'];
  const allClasses = includeRoadFallback ? [...walkClasses, ...roadClasses] : walkClasses;

  const opts: Options = {
    overtureRelease,
    overtureS3Region,
    outputDir,
    classes: allClasses,
    bbox: hasBbox ? bbox as any : null,
    generateSqlOnly,
  };

  console.log('Configuration:');
  console.log(`  Overture Release: ${opts.overtureRelease}`);
  console.log(`  Classes: ${opts.classes.join(', ')}`);
  if (opts.bbox) {
    console.log(`  Bounding Box: [${opts.bbox.west}, ${opts.bbox.south}, ${opts.bbox.east}, ${opts.bbox.north}]`);
  } else {
    console.log(`  Bounding Box: None (worldwide)`);
  }
  console.log(`  Output Directory: ${opts.outputDir}`);
  console.log(`  Generate SQL Only: ${opts.generateSqlOnly}\n`);

  // Ensure output directory exists
  if (!fs.existsSync(opts.outputDir)) {
    fs.mkdirSync(opts.outputDir, { recursive: true });
  }

  // Generate SQL files
  generateSQLFiles(opts);

  if (generateSqlOnly) {
    console.log('✓ SQL files generated. Review and execute them manually.');
    return;
  }

  // Export data
  await exportWalkNetwork(opts);

  console.log('\n=== Next Steps ===');
  console.log('1. Review the generated SQL file:');
  console.log(`   ${path.join(opts.outputDir, 'load_walk_network.sql')}`);
  console.log('\n2. Load the data into Supabase using ONE of these methods:');
  console.log('   A) Supabase SQL Editor:');
  console.log('      - Open Supabase Dashboard → SQL Editor');
  console.log('      - Copy and paste the contents of load_walk_network.sql');
  console.log('      - Run the query');
  console.log('\n   B) psql command line:');
  console.log(`      psql "YOUR_DATABASE_URL" -f ${path.join(opts.outputDir, 'load_walk_network.sql')}`);
  console.log('\n   C) Using storage.buckets (for large files):');
  console.log('      - Upload the CSV to a private Supabase Storage bucket');
  console.log('      - Use SELECT storage.bucket_list() and COPY commands');
  console.log('\n3. Verify the load:');
  console.log('   SELECT class, subclass, COUNT(*) FROM overture_transportation GROUP BY class, subclass;');
}

function generateSQLFiles(opts: Options) {
  const csvPath = path.join(opts.outputDir, 'walk_network.csv');
  const parquetPath = path.join(opts.outputDir, 'walk_network.parquet');

  // Main load SQL
  const loadSql = `-- Load Walk Network into Supabase
-- Generated: ${new Date().toISOString()}
-- Overture Release: ${opts.overtureRelease}
-- Classes: ${opts.classes.join(', ')}
${opts.bbox ? `-- Bounding Box: [${opts.bbox.west}, ${opts.bbox.south}, ${opts.bbox.east}, ${opts.bbox.north}]` : '-- Bounding Box: Worldwide'}

-- Method 1: If using CSV with WKT geometry (recommended for smaller datasets < 100MB)
-- Upload walk_network.csv to Supabase Storage or your server, then:

-- NOTE: Supabase SQL Editor doesn't support \\COPY directly.
-- Use one of these alternatives:

-- Option A: Using pg_http extension to load from URL (if available)
-- CREATE EXTENSION IF NOT EXISTS http;
-- 
-- WITH csv_data AS (
--   SELECT unnest(string_to_array(content::text, E'\\n')) as line
--   FROM http_get('https://your-cdn/walk_network.csv') 
-- )
-- INSERT INTO overture_transportation (gers_id, class, subclass, geom)
-- SELECT 
--   split_part(line, ',', 1) as gers_id,
--   split_part(line, ',', 2) as class,
--   NULLIF(split_part(line, ',', 3), '') as subclass,
--   ST_GeomFromText(split_part(line, ',', 4), 4326) as geom
-- FROM csv_data
-- WHERE line NOT LIKE '%gers_id%';  -- Skip header

-- Option B: Generate INSERT statements (for small datasets)
-- Use the generated insert_walk_network.sql file

-- Option C: Use external tool (psql, DBeaver, etc.)
-- \\COPY overture_transportation(gers_id, class, subclass, geom) FROM 'walk_network.csv' CSV HEADER;

-- Method 2: Using Parquet via DuckDB WASM or external process
-- If you have DuckDB connected to your Supabase Postgres:
-- INSERT INTO overture_transportation (gers_id, class, subclass, geom)
-- SELECT 
--   gers_id,
--   class,
--   subclass,
--   ST_GeomFromGeoJSON(geom_geojson) as geom
-- FROM read_parquet('${parquetPath.replace(/\/g, '/')}');

-- Verify the load:
SELECT 'Walk network load complete' as status;
SELECT class, subclass, COUNT(*) as cnt 
FROM overture_transportation 
WHERE class IN (${opts.classes.map(c => `'${c}'`).join(', ')})
GROUP BY class, subclass 
ORDER BY class, subclass;
`;

  fs.writeFileSync(path.join(opts.outputDir, 'load_walk_network.sql'), loadSql);

  // Generate INSERT statements for small datasets
  const insertSql = `-- INSERT statements for walk network
-- Use this for small datasets where CSV loading isn't available
-- Generated: ${new Date().toISOString()}

-- Note: This file will be populated after data export if --generate-inserts is used
-- For large datasets, use CSV or Parquet loading methods instead

BEGIN;

-- Truncate and load pattern (optional)
-- DELETE FROM overture_transportation WHERE class IN (${opts.classes.map(c => `'${c}'`).join(', ')});

-- INSERT statements will be appended here after export if using --batch-inserts option
`;

  fs.writeFileSync(path.join(opts.outputDir, 'insert_walk_network.sql'), insertSql);

  console.log('Generated SQL files:');
  console.log(`  - ${path.join(opts.outputDir, 'load_walk_network.sql')}`);
  console.log(`  - ${path.join(opts.outputDir, 'insert_walk_network.sql')}\n`);
}

async function exportWalkNetwork(opts: Options) {
  const outputParquet = path.join(opts.outputDir, 'walk_network.parquet');
  const outputCsv = path.join(opts.outputDir, 'walk_network.csv');

  console.log('Initializing DuckDB...');
  const db = new duckdb.Database(':memory:');
  const conn = db.connect();

  const runQuery = (sql: string): Promise<any[]> => {
    return new Promise((resolve, reject) => {
      conn.all(sql, (err: any, result: any) => {
        if (err) reject(err);
        else resolve(result || []);
      });
    });
  };

  const runExec = (sql: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      conn.exec(sql, (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });
  };

  try {
    // Load extensions
    console.log('Loading extensions...');
    await runExec('INSTALL spatial; LOAD spatial;');
    await runExec('INSTALL httpfs; LOAD httpfs;');

    // Configure S3
    await runExec(`SET s3_region='${opts.overtureS3Region}';`);
    await runExec(`SET s3_access_key_id='';`);
    await runExec(`SET s3_secret_access_key='';`);

    const overtureBucket = `s3://overturemaps-${opts.overtureS3Region}/release/${opts.overtureRelease}/theme=transportation/type=segment/*`;
    const classList = opts.classes.map(c => `'${c}'`).join(', ');

    // Build bbox condition
    let bboxCondition = '';
    if (opts.bbox) {
      bboxCondition = `
        AND bbox.xmin BETWEEN ${opts.bbox.west} AND ${opts.bbox.east}
        AND bbox.ymin BETWEEN ${opts.bbox.south} AND ${opts.bbox.north}`;
    }

    // Count records
    console.log('Counting records...');
    const countQuery = `
      SELECT COUNT(*) as cnt
      FROM read_parquet('${overtureBucket}', hive_partitioning=1)
      WHERE subtype = 'road'
        AND class IN (${classList})
        AND geometry IS NOT NULL
        ${bboxCondition}
    `;
    const countResult = await runQuery(countQuery);
    const totalCount = countResult[0]?.cnt || 0;
    console.log(`Found ${totalCount.toLocaleString()} segments to export\n`);

    if (totalCount === 0) {
      console.log('No segments found. Check your filter criteria.');
      return;
    }

    if (totalCount > 5000000) {
      console.log('⚠️  Warning: Large dataset detected (> 5M records)');
      console.log('   Consider using a bounding box to limit the export.');
      console.log('   Or use the --generate-sql-only option and run the export manually.\n');
    }

    // Export to Parquet
    console.log('Exporting to Parquet...');
    const startTime = Date.now();

    await runExec(`
      COPY (
        SELECT 
          id as gers_id,
          class,
          subclass,
          ST_AsGeoJSON(geometry) as geom_geojson
        FROM read_parquet('${overtureBucket}', hive_partitioning=1)
        WHERE subtype = 'road'
          AND class IN (${classList})
          AND geometry IS NOT NULL
          ${bboxCondition}
      ) TO '${outputParquet}' (FORMAT PARQUET)
    `);

    console.log(`✓ Parquet exported: ${outputParquet}`);

    // Export to CSV with WKT (for easier loading)
    console.log('Exporting to CSV with WKT geometry...');
    await runExec(`
      COPY (
        SELECT 
          id as gers_id,
          class,
          subclass,
          ST_AsText(geometry) as geom_wkt
        FROM read_parquet('${overtureBucket}', hive_partitioning=1)
        WHERE subtype = 'road'
          AND class IN (${classList})
          AND geometry IS NOT NULL
          ${bboxCondition}
      ) TO '${outputCsv}' (HEADER, DELIMITER ',')
    `);

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const parquetSize = (fs.statSync(outputParquet).size / 1024 / 1024).toFixed(2);
    const csvSize = (fs.statSync(outputCsv).size / 1024 / 1024).toFixed(2);

    console.log(`✓ CSV exported: ${outputCsv}`);
    console.log(`\nExport complete in ${formatTime(elapsed)}:`);
    console.log(`  Parquet: ${parquetSize} MB (${totalCount.toLocaleString()} records)`);
    console.log(`  CSV: ${csvSize} MB`);

    // Warn about CSV size for Supabase SQL Editor
    const csvSizeMB = parseFloat(csvSize);
    if (csvSizeMB > 10) {
      console.log(`\n⚠️  CSV file is large (${csvSize} MB).`);
      console.log('   Supabase SQL Editor may have query size limits.');
      console.log('   Consider:');
      console.log('   - Using a bounding box for smaller regions');
      console.log('   - Using psql command line instead');
      console.log('   - Splitting the CSV into smaller files');
    }

    // Generate sample INSERT statements for verification
    console.log('\nGenerating sample INSERT statements...');
    const samples = await runQuery(`
      SELECT gers_id, class, subclass, ST_AsText(ST_GeomFromGeoJSON(geom_geojson)) as geom_wkt
      FROM read_parquet('${outputParquet}')
      LIMIT 3
    `);

    const sampleInserts = samples.map((row: any) => 
      `INSERT INTO overture_transportation (gers_id, class, subclass, geom) VALUES ` +
      `('${row.gers_id}', '${row.class}', ${row.subclass ? `'${row.subclass}'` : 'NULL'}, ` +
      `ST_SetSRID(ST_GeomFromText('${row.geom_wkt}'), 4326));`
    ).join('\n');

    fs.writeFileSync(
      path.join(opts.outputDir, 'sample_inserts.sql'),
      `-- Sample INSERT statements for verification\n-- Run these first to test your setup\n\n${sampleInserts}\n`
    );
    console.log(`  Sample INSERTs saved to: ${path.join(opts.outputDir, 'sample_inserts.sql')}`);

  } finally {
    conn.close?.();
    db.close?.();
  }
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
