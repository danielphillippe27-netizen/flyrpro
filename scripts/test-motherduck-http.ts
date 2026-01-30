/**
 * Test script for MotherDuckHttpService
 * 
 * Run with: npx tsx scripts/test-motherduck-http.ts
 * 
 * Tests the HTTP API by executing a simple query against MotherDuck.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

async function main() {
  console.log('=== MotherDuck HTTP API Test ===\n');
  
  // Check token
  const token = process.env.MOTHERDUCK_TOKEN;
  if (!token) {
    console.error('ERROR: MOTHERDUCK_TOKEN not set in environment');
    process.exit(1);
  }
  console.log('✓ MOTHERDUCK_TOKEN found (length:', token.length, ')\n');

  // Import the service dynamically to ensure env vars are loaded
  const { MotherDuckHttpService } = await import('../lib/services/MotherDuckHttpService');
  
  console.log('Testing HTTP API availability...');
  const isAvailable = MotherDuckHttpService.isAvailable();
  console.log('HTTP API available:', isAvailable, '\n');

  if (!isAvailable) {
    console.error('ERROR: HTTP API not available');
    process.exit(1);
  }

  // Test 1: Simple query
  console.log('--- Test 1: Simple SELECT query ---');
  try {
    const result = await MotherDuckHttpService.executeQuery(
      'SELECT 1 as test_value, current_timestamp as query_time',
      'my_db'
    );
    console.log('Result:', JSON.stringify(result, null, 2));
    console.log('✓ Simple query succeeded\n');
  } catch (error) {
    console.error('✗ Simple query failed:', error);
    process.exit(1);
  }

  // Test 2: Query Overture S3 data
  // Note: MotherDuck MCP API handles S3 region configuration automatically
  // Do NOT use SET s3_region as it's locked in the hosted environment
  console.log('--- Test 2: Count buildings in small bbox ---');
  try {
    const query = `
SELECT COUNT(*) as building_count
FROM read_parquet('s3://overturemaps-us-west-2/release/2025-12-17.0/theme=buildings/type=building/*', hive_partitioning=1)
WHERE bbox.xmin <= -122.40 AND bbox.xmax >= -122.41
  AND bbox.ymin <= 37.78 AND bbox.ymax >= 37.77
LIMIT 1;
`;
    const result = await MotherDuckHttpService.executeQuery(query, 'my_db');
    console.log('Building count in SF area:', result[0]?.building_count);
    console.log('✓ S3 query succeeded\n');
  } catch (error) {
    console.error('✗ S3 query failed:', error);
    console.log('(This might fail due to row limits or timeout - not critical)\n');
  }

  // Test 3: Direct query with very small bbox (just a few buildings)
  console.log('--- Test 3: Direct query with tiny bbox ---');
  try {
    // Use a very small area - just ~100 meters
    const tinyQuery = `
SELECT 
    id as gers_id,
    ST_AsGeoJSON(geometry) AS geometry,
    COALESCE(height, 8) as height
FROM read_parquet('s3://overturemaps-us-west-2/release/2025-12-17.0/theme=buildings/type=building/*', hive_partitioning=1)
WHERE bbox.xmin BETWEEN -122.4015 AND -122.4005
  AND bbox.ymin BETWEEN 37.7875 AND 37.7885
LIMIT 10;
`;
    const result = await MotherDuckHttpService.executeQuery(tinyQuery, 'my_db');
    console.log(`Found ${result.length} buildings in tiny bbox`);
    if (result.length > 0) {
      console.log('First building gers_id:', result[0].gers_id);
    }
    console.log('✓ Tiny bbox query succeeded\n');
  } catch (error: any) {
    console.error('✗ Tiny bbox query failed:', error.message);
    console.log('(Overture S3 queries may time out - this is a known limitation)\n');
  }

  // Test 4: Test polygon query method with tiny polygon
  console.log('--- Test 4: getBuildingsInPolygon with tiny polygon ---');
  try {
    // Even smaller polygon - ~100m x 100m
    const tinyPolygon = {
      type: 'Polygon',
      coordinates: [[
        [-122.4015, 37.7875],
        [-122.4005, 37.7875],
        [-122.4005, 37.7885],
        [-122.4015, 37.7885],
        [-122.4015, 37.7875],
      ]],
    };
    const buildings = await MotherDuckHttpService.getBuildingsInPolygon(tinyPolygon);
    console.log(`Found ${buildings.length} buildings in tiny polygon`);
    if (buildings.length > 0) {
      console.log('First building:', {
        gers_id: buildings[0].gers_id,
        height: buildings[0].height,
      });
    }
    console.log('✓ getBuildingsInPolygon succeeded\n');
  } catch (error: any) {
    console.error('✗ getBuildingsInPolygon failed:', error.message);
    console.log('(Overture S3 queries may time out due to 55s MCP API limit)\n');
  }

  console.log('=== All tests completed ===');
}

main().catch(console.error);
