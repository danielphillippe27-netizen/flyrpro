/**
 * Test script for MotherDuckHttpService
 * 
 * Run with: npx tsx scripts/test-motherduck-http.ts
 * 
 * Tests the HTTP API by querying the pre-loaded overture_flyr database.
 * Run load-overture-to-motherduck.ts first to populate the database.
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
      'overture_flyr'
    );
    console.log('Result:', JSON.stringify(result, null, 2));
    console.log('✓ Simple query succeeded\n');
  } catch (error) {
    console.error('✗ Simple query failed:', error);
    process.exit(1);
  }

  // Test 2: Count buildings in pre-loaded database
  console.log('--- Test 2: Count buildings in overture_flyr ---');
  try {
    const result = await MotherDuckHttpService.executeQuery(
      'SELECT COUNT(*) as total FROM overture_flyr.buildings',
      'overture_flyr'
    );
    console.log('Total buildings in database:', result[0]?.total?.toLocaleString());
    console.log('✓ Building count succeeded\n');
  } catch (error: any) {
    console.error('✗ Building count failed:', error.message);
    console.log('(Run load-overture-to-motherduck.ts first to populate the database)\n');
  }

  // Test 3: Count addresses in pre-loaded database
  console.log('--- Test 3: Count addresses in overture_flyr ---');
  try {
    const result = await MotherDuckHttpService.executeQuery(
      'SELECT COUNT(*) as total FROM overture_flyr.addresses',
      'overture_flyr'
    );
    console.log('Total addresses in database:', result[0]?.total?.toLocaleString());
    console.log('✓ Address count succeeded\n');
  } catch (error: any) {
    console.error('✗ Address count failed:', error.message);
    console.log('(Run load-overture-to-motherduck.ts first to populate the database)\n');
  }

  // Test 4: Query buildings in a small San Francisco polygon
  console.log('--- Test 4: getBuildingsInPolygon (SF neighborhood) ---');
  try {
    const sfPolygon = {
      type: 'Polygon',
      coordinates: [[
        [-122.42, 37.77],
        [-122.40, 37.77],
        [-122.40, 37.79],
        [-122.42, 37.79],
        [-122.42, 37.77],
      ]],
    };
    const buildings = await MotherDuckHttpService.getBuildingsInPolygon(sfPolygon);
    console.log(`Found ${buildings.length} buildings in SF polygon`);
    if (buildings.length > 0) {
      console.log('First building:', {
        gers_id: buildings[0].gers_id,
        height: buildings[0].height,
      });
    }
    console.log('✓ getBuildingsInPolygon succeeded\n');
  } catch (error: any) {
    console.error('✗ getBuildingsInPolygon failed:', error.message);
  }

  // Test 5: Query addresses in a small polygon
  console.log('--- Test 5: getAddressesInPolygon (SF neighborhood) ---');
  try {
    const sfPolygon = {
      type: 'Polygon',
      coordinates: [[
        [-122.42, 37.77],
        [-122.40, 37.77],
        [-122.40, 37.79],
        [-122.42, 37.79],
        [-122.42, 37.77],
      ]],
    };
    const addresses = await MotherDuckHttpService.getAddressesInPolygon(sfPolygon);
    console.log(`Found ${addresses.length} addresses in SF polygon`);
    if (addresses.length > 0) {
      console.log('First address:', {
        gers_id: addresses[0].gers_id,
        formatted: addresses[0].formatted,
      });
    }
    console.log('✓ getAddressesInPolygon succeeded\n');
  } catch (error: any) {
    console.error('✗ getAddressesInPolygon failed:', error.message);
  }

  console.log('=== All tests completed ===');
}

main().catch(console.error);
