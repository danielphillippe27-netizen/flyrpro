#!/usr/bin/env tsx
/**
 * Schema Inspector for Overture Parquet Files
 * 
 * This script connects to MotherDuck and inspects the actual schema
 * of Overture addresses and buildings parquet files to see exactly
 * what columns are available and their data types.
 * 
 * This helps debug "Column not found" errors by showing the real schema
 * instead of guessing based on documentation.
 * 
 * Usage:
 *   npx tsx scripts/inspect-overture-schema.ts
 * 
 * Output:
 *   - Lists all columns in addresses theme with their types
 *   - Lists all columns in buildings theme with their types
 *   - Shows STRUCT fields if columns are nested
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import duckdb from 'duckdb';

// Load environment variables
dotenv.config({ path: '.env.local' });
dotenv.config();

const OVERTURE_RELEASE = process.env.OVERTURE_RELEASE || '2025-12-17.0';
const S3_REGION = 'us-west-2';

// Overture S3 paths
const ADDRESSES_PATH = `s3://overturemaps-us-west-2/release/${OVERTURE_RELEASE}/theme=addresses/type=address/*`;
const BUILDINGS_PATH = `s3://overturemaps-us-west-2/release/${OVERTURE_RELEASE}/theme=buildings/type=building/*`;

/**
 * Get or create DuckDB database connection
 */
async function getDatabase(): Promise<duckdb.Database> {
  const MOTHERDUCK_TOKEN = process.env.MOTHERDUCK_TOKEN;
  
  if (!MOTHERDUCK_TOKEN) {
    throw new Error('MOTHERDUCK_TOKEN environment variable is required');
  }

  console.log('🔌 Connecting to MotherDuck...');
  const db = new duckdb.Database('md:');
  
  // Give MotherDuck a moment to establish connection
  await new Promise(resolve => setTimeout(resolve, 100));
  
  return db;
}

/**
 * Get connection with spatial extension loaded
 */
async function getConnection(): Promise<duckdb.Connection> {
  const db = await getDatabase();
  const conn = db.connect();

  // Set home directory
  await new Promise<void>((resolve, reject) => {
    conn.exec("SET home_directory='/tmp/duckdb';", (err) => {
      if (err) {
        console.warn(`⚠️  Failed to set home_directory:`, err.message);
      }
      resolve();
    });
  });

  // Load spatial extension
  await new Promise<void>((resolve, reject) => {
    conn.exec('INSTALL spatial; LOAD spatial;', (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  return conn;
}

/**
 * Execute a query and return results
 */
async function executeQuery(conn: duckdb.Connection, query: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    conn.all(query, (err, rows: any[]) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

/**
 * Inspect schema of a parquet file
 */
async function inspectSchema(
  conn: duckdb.Connection,
  path: string,
  themeName: string
): Promise<void> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📋 Inspecting ${themeName} Theme`);
  console.log(`${'='.repeat(80)}`);
  console.log(`Path: ${path}\n`);

  try {
    // Set S3 region
    await executeQuery(conn, `SET s3_region='${S3_REGION}';`);

    // DESCRIBE query to get column names and types
    // Using LIMIT 0 to avoid reading data, just get schema
    const describeQuery = `
      DESCRIBE SELECT * 
      FROM read_parquet('${path}', hive_partitioning=1) 
      LIMIT 0;
    `;

    console.log('🔍 Running DESCRIBE query...\n');
    const schema = await executeQuery(conn, describeQuery);

    if (schema.length === 0) {
      console.log('⚠️  No columns found. This might mean:');
      console.log('   - The path is incorrect');
      console.log('   - The release version doesn\'t exist');
      console.log('   - Network/permissions issue');
      return;
    }

    console.log(`✅ Found ${schema.length} columns:\n`);
    
    // Group columns by type for better readability
    const columnsByType: Record<string, any[]> = {};
    
    schema.forEach((col: any) => {
      const type = col.column_type || col.type || 'UNKNOWN';
      if (!columnsByType[type]) {
        columnsByType[type] = [];
      }
      columnsByType[type].push(col);
    });

    // Print columns grouped by type
    for (const [type, columns] of Object.entries(columnsByType)) {
      console.log(`📦 ${type}:`);
      columns.forEach((col: any) => {
        const name = col.column_name || col.name || 'unknown';
        const fullType = col.column_type || col.type || 'UNKNOWN';
        console.log(`   - ${name.padEnd(40)} (${fullType})`);
      });
      console.log('');
    }

    // Also try to get a sample row to see actual structure
    console.log('🔍 Fetching sample row to inspect nested structures...\n');
    try {
      const sampleQuery = `
        SELECT * 
        FROM read_parquet('${path}', hive_partitioning=1) 
        LIMIT 1;
      `;
      
      const sample = await executeQuery(conn, sampleQuery);
      
      if (sample.length > 0) {
        console.log('📄 Sample row structure:');
        const sampleRow = sample[0];
        Object.keys(sampleRow).forEach(key => {
          const value = sampleRow[key];
          const type = typeof value;
          const preview = type === 'object' && value !== null
            ? JSON.stringify(value).substring(0, 100) + (JSON.stringify(value).length > 100 ? '...' : '')
            : String(value).substring(0, 100);
          
          console.log(`   ${key.padEnd(40)} = ${preview}`);
        });
      } else {
        console.log('⚠️  No sample rows found');
      }
    } catch (sampleErr: any) {
      console.log(`⚠️  Could not fetch sample row: ${sampleErr.message}`);
    }

  } catch (error: any) {
    console.error(`❌ Error inspecting ${themeName} schema:`);
    console.error(`   ${error.message}`);
    if (error.stack) {
      console.error(`\n   Stack: ${error.stack.substring(0, 500)}`);
    }
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🔍 Overture Schema Inspector\n');
  console.log(`Using Overture release: ${OVERTURE_RELEASE}`);
  console.log(`S3 Region: ${S3_REGION}\n`);

  // Check environment
  if (!process.env.MOTHERDUCK_TOKEN) {
    console.error('❌ Missing MOTHERDUCK_TOKEN environment variable');
    console.error('   Set it in .env.local or your environment');
    process.exit(1);
  }

  let conn: duckdb.Connection | null = null;

  try {
    // Get connection
    conn = await getConnection();
    console.log('✅ Connected to MotherDuck\n');

    // Inspect addresses theme
    await inspectSchema(conn, ADDRESSES_PATH, 'Addresses');

    // Inspect buildings theme
    await inspectSchema(conn, BUILDINGS_PATH, 'Buildings');

    console.log(`\n${'='.repeat(80)}`);
    console.log('✅ Schema inspection complete!');
    console.log(`${'='.repeat(80)}\n`);

  } catch (error) {
    console.error('\n❌ Schema inspection failed:');
    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`);
      if (error.stack) {
        console.error(`   Stack: ${error.stack.substring(0, 500)}`);
      }
    } else {
      console.error(`   Error: ${JSON.stringify(error, null, 2)}`);
    }
    process.exit(1);
  } finally {
    if (conn) {
      conn.close();
    }
  }
}

// Run the script
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
