#!/usr/bin/env tsx
/**
 * Export Overture buildings joined with campaign addresses to GeoJSON
 * Node-First Architecture: Uses Supabase JS client (HTTPS) instead of direct database connections
 * This script creates a GeoJSON file that can be converted to PMTiles
 * 
 * Usage:
 *   npx tsx scripts/export-overture-tiles.ts [campaignId]
 *   npx tsx scripts/export-overture-tiles.ts --bbox minLon minLat maxLon maxLat
 * 
 * Examples:
 *   npx tsx scripts/export-overture-tiles.ts abc123-def456
 *   npx tsx scripts/export-overture-tiles.ts --bbox -79.5 43.6 -79.3 43.7
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables BEFORE importing services that depend on them
console.log('[DEBUG] Loading dotenv...');
const dotenvResult1 = dotenv.config({ path: '.env.local' });
console.log('[DEBUG] dotenv.config(.env.local) result:', { error: dotenvResult1.error?.message, parsed: Object.keys(dotenvResult1.parsed || {}).length });
const dotenvResult2 = dotenv.config();
console.log('[DEBUG] dotenv.config() result:', { error: dotenvResult2.error?.message, parsed: Object.keys(dotenvResult2.parsed || {}).length });
console.log('[DEBUG] After dotenv - MOTHERDUCK_TOKEN exists:', !!process.env.MOTHERDUCK_TOKEN);
console.log('[DEBUG] MOTHERDUCK_TOKEN length:', process.env.MOTHERDUCK_TOKEN?.length || 0);
console.log('[DEBUG] MOTHERDUCK_TOKEN prefix:', process.env.MOTHERDUCK_TOKEN?.substring(0, 30) || 'N/A');

import { createClient } from '@supabase/supabase-js';
import wkx from 'wkx';
import { MotherDuckUnifiedService } from '../lib/services/MotherDuckUnifiedService';

console.log('[DEBUG] After import - MOTHERDUCK_TOKEN exists:', !!process.env.MOTHERDUCK_TOKEN);

interface ExportOptions {
  campaignId?: string;
  bbox?: {
    minLon: number;
    minLat: number;
    maxLon: number;
    maxLat: number;
  };
  outputPath?: string;
}

/**
 * Initialize Supabase JS client
 */
function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kfnsnwqylsdsbgnwgxva.supabase.co';
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseServiceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is required');
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Robust geometry parser that handles multiple PostGIS formats:
 * - GeoJSON objects (already parsed)
 * - WKB/EWKB hex strings (00 or 01 prefix)
 * - GeoJSON string encoding
 */
function parseGeomToGeoJSON(geom: unknown): any | null {
  // Already an object (some setups / views)
  if (geom && typeof geom === 'object') return geom;

  if (typeof geom === 'string') {
    const trimmed = geom.trim();

    // WKB/EWKB hex usually begins with 00 or 01 (endianness)
    // Check if it's all hex and long enough to be WKB
    const looksLikeHexWkb = /^[0-9a-fA-F]+$/.test(trimmed) && 
                            (trimmed.startsWith('00') || trimmed.startsWith('01'));

    if (looksLikeHexWkb) {
      try {
        const buffer = Buffer.from(trimmed, 'hex');
        return wkx.Geometry.parse(buffer).toGeoJSON();
      } catch (e) {
        // WKB parsing failed, fall through to JSON.parse
        console.warn(`[Export] WKB parsing failed, trying JSON:`, e);
      }
    }

    // GeoJSON string fallback
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      console.warn(`[Export] JSON parsing failed:`, e);
      return null;
    }
  }

  return null;
}

/**
 * Check if an ID looks like a UUID (contains hyphens)
 * Overture GERS IDs are typically hex strings without hyphens (e.g., "08b2...")
 * UUIDs contain hyphens (e.g., "a1b2c3d4-...")
 */
function looksLikeUuid(id: string): boolean {
  // UUID format: contains hyphens and is typically 36 chars (32 hex + 4 hyphens)
  // Simple check: if it contains hyphens, it's likely a UUID
  return id.includes('-') && id.length >= 36;
}

/**
 * Validate and log GERS ID format for debugging
 */
function validateGersIds(ids: string[]): { validCount: number; uuidCount: number; sampleIds: string[] } {
  const uuidCount = ids.filter(id => looksLikeUuid(id)).length;
  const validCount = ids.length - uuidCount;
  const sampleIds = ids.slice(0, 5); // First 5 IDs for inspection
  
  if (uuidCount > 0) {
    console.warn(`[Export] ⚠️  WARNING: Found ${uuidCount} IDs that look like UUIDs (not Overture GERS IDs)`);
    console.warn(`[Export]    Overture GERS IDs are hex strings (e.g., "08b2..."), not UUIDs (e.g., "a1b2c3d4-...")`);
    console.warn(`[Export]    Sample UUID-like IDs:`, sampleIds.filter(id => looksLikeUuid(id)).slice(0, 3));
  }
  
  return { validCount, uuidCount, sampleIds };
}

/**
 * Fetch GERS IDs (source_id) for a campaign via Supabase JS client
 */
async function fetchGersIdsForCampaign(
  supabase: ReturnType<typeof createClient>,
  campaignId: string
): Promise<string[]> {
  console.log(`[Export] Fetching GERS IDs for campaign ${campaignId} via Supabase JS client...`);

  const { data, error } = await supabase
    .from('campaign_addresses')
    .select('source_id')
    .eq('campaign_id', campaignId)
    .not('source_id', 'is', null);

  if (error) {
    throw new Error(`Failed to fetch GERS IDs: ${error.message}`);
  }

  if (!data || data.length === 0) {
    console.warn(`[Export] No GERS IDs found for campaign ${campaignId}`);
    return [];
  }

  const gersIds = data
    .map(addr => addr.source_id)
    .filter((id): id is string => id !== null && id !== undefined);

  console.log(`[Export] Found ${gersIds.length} GERS IDs for campaign`);
  return gersIds;
}

/**
 * Fetch bounding box of campaign addresses via Supabase JS client
 * Used to limit Overture query area and prevent OOM errors
 * Supabase JS client returns PostGIS Geography as GeoJSON object
 * 
 * Robust parser handles multiple GeoJSON formats:
 * - { type: 'Point', coordinates: [lon, lat] }
 * - Nested structures
 * - String-encoded GeoJSON
 */
async function fetchCampaignBoundingBox(
  supabase: ReturnType<typeof createClient>,
  campaignId: string
): Promise<{ minLon: number; minLat: number; maxLon: number; maxLat: number } | null> {
  console.log(`[Export] Fetching bounding box for campaign ${campaignId}...`);

  // Select id and geom - Supabase JS client returns PostGIS Geography as GeoJSON object
  // PostgREST automatically converts PostGIS Geography to GeoJSON format
  const { data, error } = await supabase
    .from('campaign_addresses')
    .select('id, geom')
    .eq('campaign_id', campaignId)
    .not('geom', 'is', null);

  if (error) {
    console.warn(`[Export] Failed to fetch addresses for bbox: ${error.message}`);
    return null;
  }

  if (!data || data.length === 0) {
    console.warn(`[Export] No addresses with geometry found for campaign ${campaignId}`);
    return null;
  }

  // Robust GeoJSON parser - handles multiple formats including WKB hex
  const coordinates: Array<[number, number]> = [];
  
  for (const addr of data) {
    const geom = parseGeomToGeoJSON(addr.geom);
    if (!geom) {
      console.warn(`[Export] Missing/invalid geom for address ${addr.id}`);
      continue;
    }

    // Extract coordinates from parsed GeoJSON
    let lon: number | null = null;
    let lat: number | null = null;

    if (geom.type === 'Point' && Array.isArray(geom.coordinates)) {
      const coords = geom.coordinates;
      if (coords.length >= 2) {
        lon = coords[0];
        lat = coords[1];
      }
    }

    // Validate coordinates are valid numbers
    if (typeof lon === 'number' && typeof lat === 'number' && 
        !isNaN(lon) && !isNaN(lat) &&
        isFinite(lon) && isFinite(lat)) {
      coordinates.push([lon, lat]);
    } else {
      console.warn(`[Export] Invalid coordinates for address ${addr.id}: lon=${lon}, lat=${lat}`);
    }
  }

  // Graceful exit: throw error if no valid coordinates found
  if (coordinates.length === 0) {
    throw new Error('Cannot bake: Campaign has no valid coordinates. Ensure addresses have valid geometry.');
  }

  // Calculate bounding box with dynamic padding
  const lons = coordinates.map(c => c[0]);
  const lats = coordinates.map(c => c[1]);
  
  // Calculate campaign extent
  const lonRange = Math.max(...lons) - Math.min(...lons);
  const latRange = Math.max(...lats) - Math.min(...lats);
  const maxDimension = Math.max(lonRange, latRange);
  
  // Dynamic padding: 10% of max dimension, minimum 0.01 degrees (~1km)
  // This scales from small campaigns (1km buffer) to large campaigns (10km+ buffer)
  const padding = Math.max(maxDimension * 0.1, 0.01);
  
  const bbox = {
    minLon: Math.min(...lons) - padding,
    maxLon: Math.max(...lons) + padding,
    minLat: Math.min(...lats) - padding,
    maxLat: Math.max(...lats) + padding,
  };

  console.log(`[Export] Calculated bounding box:`);
  console.log(`   Campaign extent: ${(maxDimension * 111).toFixed(2)} km (${maxDimension.toFixed(4)} degrees)`);
  console.log(`   Dynamic padding: ${(padding * 111).toFixed(2)} km (${padding.toFixed(4)} degrees)`);
  console.log(`   BBox: [${bbox.minLon.toFixed(6)}, ${bbox.minLat.toFixed(6)}] to [${bbox.maxLon.toFixed(6)}, ${bbox.maxLat.toFixed(6)}]`);
  
  return bbox;
}

/**
 * Fetch bounding box using database RPC function (Option B - cleaner architecture)
 * This computes bbox directly in PostgreSQL, eliminating geometry parsing in Node.js
 * 
 * @deprecated Currently using Option A (wkx parsing). Switch to this for production.
 */
async function fetchCampaignBoundingBoxRPC(
  supabase: ReturnType<typeof createClient>,
  campaignId: string
): Promise<{ minLon: number; minLat: number; maxLon: number; maxLat: number } | null> {
  console.log(`[Export] Fetching bounding box via RPC for campaign ${campaignId}...`);

  const { data, error } = await supabase.rpc('get_campaign_bbox', { 
    c_id: campaignId 
  });

  if (error) {
    console.warn(`[Export] Failed to fetch bbox via RPC: ${error.message}`);
    return null;
  }

  const bbox = data?.[0];
  if (!bbox) {
    throw new Error('Cannot bake: Campaign has no valid coordinates. Ensure addresses have valid geometry.');
  }

  // Calculate dynamic padding (same logic as Option A)
  const lonRange = bbox.max_lon - bbox.min_lon;
  const latRange = bbox.max_lat - bbox.min_lat;
  const maxDimension = Math.max(lonRange, latRange);
  const padding = Math.max(maxDimension * 0.1, 0.01);

  const paddedBbox = {
    minLon: bbox.min_lon - padding,
    maxLon: bbox.max_lon + padding,
    minLat: bbox.min_lat - padding,
    maxLat: bbox.max_lat + padding,
  };

  console.log(`[Export] Calculated bounding box via RPC:`);
  console.log(`   Campaign extent: ${(maxDimension * 111).toFixed(2)} km (${maxDimension.toFixed(4)} degrees)`);
  console.log(`   Dynamic padding: ${(padding * 111).toFixed(2)} km (${padding.toFixed(4)} degrees)`);
  console.log(`   BBox: [${paddedBbox.minLon.toFixed(6)}, ${paddedBbox.minLat.toFixed(6)}] to [${paddedBbox.maxLon.toFixed(6)}, ${paddedBbox.maxLat.toFixed(6)}]`);

  return paddedBbox;
}

async function exportOvertureBuildings(options: ExportOptions): Promise<void> {
  const { campaignId, bbox, outputPath = 'data/buildings.geojson' } = options;

  // Validate environment variables
  const motherDuckToken = process.env.MOTHERDUCK_TOKEN;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!motherDuckToken) {
    console.error('❌ MOTHERDUCK_TOKEN environment variable is required');
    process.exit(1);
  }

  if (!supabaseServiceKey) {
    console.error('❌ SUPABASE_SERVICE_ROLE_KEY environment variable is required');
    process.exit(1);
  }

  console.log('🚀 Starting Overture buildings export (Node-First Architecture)...');
  console.log(`   Output: ${outputPath}`);

  try {
    // Ensure data directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      console.log(`   Created directory: ${outputDir}`);
    }

    let features: any[] = [];

    if (campaignId) {
      console.log(`   Exporting buildings for campaign: ${campaignId}`);

      // Initialize Supabase JS client
      const supabase = getSupabaseClient();
      console.log('[Export] Supabase JS client initialized');

      // Fetch GERS IDs via Supabase JS client
      const gersIds = await fetchGersIdsForCampaign(supabase, campaignId);

      if (gersIds.length === 0) {
        console.warn('⚠️  No GERS IDs found for campaign. Make sure addresses have been stamped with source_id.');
        console.warn('   Run: npx tsx scripts/stamp-addresses-with-gers.ts [campaignId]');
        process.exit(0);
      }

      // Fetch bounding box to limit Overture query area (prevents OOM errors)
      // This will throw an error if no valid coordinates are found
      const bbox = await fetchCampaignBoundingBox(supabase, campaignId);
      if (!bbox) {
        throw new Error('Cannot bake: Campaign has no valid coordinates. Ensure addresses have valid geometry.');
      }
      
      console.log(`[Export] Using bounding box to limit search area (prevents OOM):`);
      console.log(`   [${bbox.minLon}, ${bbox.minLat}] to [${bbox.maxLon}, ${bbox.maxLat}]`);

      // Validate and log GERS ID format for debugging
      const idValidation = validateGersIds(gersIds);
      console.log(`[DEBUG] GERS ID validation:`);
      console.log(`   Total IDs: ${gersIds.length}`);
      console.log(`   Valid Overture IDs: ${idValidation.validCount}`);
      console.log(`   UUID-like IDs: ${idValidation.uuidCount}`);
      console.log(`   Sample IDs (first 5):`, idValidation.sampleIds);

      // Query Overture buildings by GERS IDs using new method (no ATTACH POSTGRES needed)
      // Pass bounding box to limit search area and prevent OOM errors
      console.log(`[Export] Querying Overture buildings for ${gersIds.length} GERS IDs...`);
      // #region agent log
      console.log(`[DEBUG] Before fetchBuildingsByIds - MOTHERDUCK_TOKEN in env:`, !!process.env.MOTHERDUCK_TOKEN);
      console.log(`[DEBUG] Token length:`, process.env.MOTHERDUCK_TOKEN?.length || 0);
      // #endregion
      let buildings = await MotherDuckUnifiedService.fetchBuildingsByIds(gersIds, bbox || undefined);
      
      // 🛠️ FALLBACK: If IDs return nothing, try searching by BBox
      if (!buildings || buildings.length === 0) {
        console.warn("⚠️  No buildings found by ID. Falling back to Spatial Search (BBox)...");
        console.warn("   This may indicate:");
        console.warn("   1. Wrong IDs (UUIDs instead of Overture GERS IDs)");
        console.warn("   2. IDs from an older Overture release");
        console.warn("   3. Spatial filter conflict");
        console.log(`[Export] Performing spatial search in bounding box...`);
        buildings = await MotherDuckUnifiedService.fetchBuildingsByBBox(bbox);
        console.log(`[Export] Spatial search found ${buildings.length} buildings.`);
      }

      // Get campaign info for additional metadata
      const { data: campaignData } = await supabase
        .from('campaigns')
        .select('id, name, title')
        .eq('id', campaignId)
        .single();

      const campaignName = campaignData?.title || campaignData?.name || 'Unknown Campaign';

      // Transform to GeoJSON features
      features = buildings.map(building => ({
        type: 'Feature',
        geometry: building.geometry,
        properties: {
          id: building.building_id, // GERS ID
          gers_id: building.building_id, // Explicit GERS ID field
          height: building.height || building.render_height || 10,
          num_floors: Math.round((building.height || building.render_height || 10) / 3), // Estimate: ~3m per floor
          full_address: building.full_address,
          campaign_name: campaignName,
          campaign_status: building.campaign_status || 'pending',
          address_id: building.address_id,
          render_height: building.render_height,
          min_height: building.min_height || 0,
        },
      }));

      console.log(`   ✅ Found ${features.length} buildings for campaign`);
    } else if (bbox) {
      console.log(`   Exporting buildings for bounding box: [${bbox.minLon}, ${bbox.minLat}] to [${bbox.maxLon}, ${bbox.maxLat}]`);
      
      // For bbox export, we need to query Overture directly
      // This requires a custom query similar to MotherDuckUnifiedService but without campaign filtering
      console.warn('⚠️  Bbox export not yet fully implemented. Use campaignId for now.');
      features = [];
      
      console.log(`   ✅ Found ${features.length} buildings in bounding box`);
    } else {
      console.error('❌ Either campaignId or --bbox must be provided');
      console.error('   Usage: npx tsx scripts/export-overture-tiles.ts [campaignId]');
      console.error('   Usage: npx tsx scripts/export-overture-tiles.ts --bbox minLon minLat maxLon maxLat');
      process.exit(1);
    }

    if (features.length === 0) {
      console.warn('⚠️  No buildings found. Exiting without creating file.');
      process.exit(0);
    }

    // Create GeoJSON FeatureCollection
    const geojson = {
      type: 'FeatureCollection',
      features: features,
    };

    // Write to file
    fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
    
    const fileSize = fs.statSync(outputPath).size;
    const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);
    
    console.log(`   ✅ GeoJSON exported successfully!`);
    console.log(`   📊 Statistics:`);
    console.log(`      - Features: ${features.length}`);
    console.log(`      - File size: ${fileSizeMB} MB`);
    console.log(`      - Location: ${path.resolve(outputPath)}`);
    console.log('');
    console.log('📝 Next steps:');
    console.log('   1. Convert to PMTiles: tippecanoe -o buildings.pmtiles -zg --projection=EPSG:4326 -L buildings:data/buildings.geojson data/buildings.geojson');
    console.log('   2. Upload to Supabase Storage bucket: map-tiles');
    console.log('   3. See README_TILES.md for detailed instructions');
  } catch (error: any) {
    console.error('❌ Export failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Parse command line arguments
function parseArgs(): ExportOptions {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    return {};
  }

  if (args[0] === '--bbox' && args.length === 5) {
    return {
      bbox: {
        minLon: parseFloat(args[1]),
        minLat: parseFloat(args[2]),
        maxLon: parseFloat(args[3]),
        maxLat: parseFloat(args[4]),
      },
    };
  }

  if (args[0] === '--help' || args[0] === '-h') {
    console.log('Usage:');
    console.log('  npx tsx scripts/export-overture-tiles.ts [campaignId]');
    console.log('  npx tsx scripts/export-overture-tiles.ts --bbox minLon minLat maxLon maxLat');
    console.log('');
    console.log('Examples:');
    console.log('  npx tsx scripts/export-overture-tiles.ts abc123-def456');
    console.log('  npx tsx scripts/export-overture-tiles.ts --bbox -79.5 43.6 -79.3 43.7');
    process.exit(0);
  }

  // Assume first argument is campaignId
  return {
    campaignId: args[0],
  };
}

// Main execution
const options = parseArgs();
exportOvertureBuildings(options).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
