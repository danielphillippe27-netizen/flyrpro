import { NextRequest, NextResponse } from 'next/server';
import { MotherDuckUnifiedService } from '@/lib/services/MotherDuckUnifiedService';

export const runtime = 'nodejs';

/**
 * Create an 8-sided polygon buffer around a point
 * Returns a valid GeoJSON Polygon with closed loop (first == last coordinate)
 * @param lng Longitude of the center point
 * @param lat Latitude of the center point
 * @param radiusInDegrees Radius in degrees (approximately 0.00005 = ~5.5 meters)
 * @returns GeoJSON Polygon geometry
 */
function createOctagonBuffer(lng: number, lat: number, radiusInDegrees: number = 0.00005): { type: 'Polygon'; coordinates: number[][][] } {
  const sides = 8;
  const coordinates: number[][] = [];
  
  // Create 8 points around the circle
  for (let i = 0; i <= sides; i++) {
    const angle = (i * 2 * Math.PI) / sides;
    const x = lng + radiusInDegrees * Math.cos(angle);
    const y = lat + radiusInDegrees * Math.sin(angle);
    coordinates.push([x, y]);
  }
  
  // Ensure the polygon closes (last point == first point)
  // This is already handled by the loop going to i <= sides, but we'll be explicit
  if (coordinates.length > 0 && 
      (coordinates[coordinates.length - 1][0] !== coordinates[0][0] || 
       coordinates[coordinates.length - 1][1] !== coordinates[0][1])) {
    coordinates.push([coordinates[0][0], coordinates[0][1]]);
  }
  
  return {
    type: 'Polygon',
    coordinates: [coordinates],
  };
}

/**
 * @deprecated This endpoint is deprecated in favor of PMTiles-based rendering.
 * 
 * The frontend now uses PMTiles files stored in Supabase Storage for building data.
 * This endpoint is kept for backward compatibility and the export script (scripts/export-overture-tiles.ts).
 * 
 * GET endpoint for fetching unified building data from MotherDuck
 * Returns GeoJSON with Overture footprints, addresses, and campaign data
 * 
 * Expected GeoJSON Feature properties:
 * - building_id: Overture building ID
 * - render_height: Height for fill-extrusion
 * - full_address: Overture address (from addresses[0].freeform)
 * - campaign_name: Campaign name from Supabase
 * - campaign_status: Campaign status
 * - geometry: Polygon geometry from Overture
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { campaignId: string } }
) {
  try {
    const { campaignId } = params;

    if (!campaignId) {
      return NextResponse.json({ error: 'campaignId is required' }, { status: 400 });
    }

    // Try MotherDuck first if enabled and password is available
    const motherDuckEnabled = !!process.env.MOTHERDUCK_TOKEN;
    const supabasePassword = process.env.SUPABASE_DB_PASSWORD || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (motherDuckEnabled && supabasePassword) {
      try {
        console.log(`[buildings-unified] Using MotherDuck for campaign ${campaignId}`);
        const unifiedBuildings = await MotherDuckUnifiedService.fetchUnifiedBuildingsWithSQL(
          campaignId,
          supabasePassword
        );

        if (unifiedBuildings.length > 0) {
          const features = unifiedBuildings.map(building => ({
            type: 'Feature',
            geometry: building.geometry,
            properties: {
              building_id: building.building_id,
              gers_id: (building as any).gers_id || building.building_id, // GERS ID for building-address bridge
              render_height: building.render_height,
              full_address: building.full_address,
              campaign_name: building.campaign_name,
              campaign_status: building.campaign_status,
              address_id: building.address_id,
              height: building.height,
              min_height: building.min_height,
            },
          }));

          return NextResponse.json({
            type: 'FeatureCollection',
            features,
          });
        }
      } catch (error) {
        console.warn('[buildings-unified] MotherDuck query failed, falling back to existing services:', error);
        // Fall through to fallback approach
      }
    }

    // Fallback: Combine existing data sources (transition phase)
    console.log(`[buildings-unified] Using fallback approach for campaign ${campaignId}`);
    
    // Import services directly (server-side)
    const { CampaignsService } = await import('@/lib/services/CampaignsService');
    const { BuildingService } = await import('@/lib/services/BuildingService');
    
    // Fetch campaign for name
    const campaign = await CampaignsService.fetchCampaign(campaignId);
    const campaignName = campaign?.title || 'Unknown Campaign';
    
    // Fetch buildings
    let buildings: any[] = [];
    try {
      buildings = await BuildingService.fetchCampaignBuildings(campaignId);
      if (buildings.length === 0) {
        const { MapService } = await import('@/lib/services/MapService');
        buildings = await MapService.fetchCampaignBuildings(campaignId);
      }
    } catch (error) {
      console.warn('Error fetching buildings:', error);
    }
    
    // Fetch addresses
    const addresses = await CampaignsService.fetchAddresses(campaignId);

    // Transform buildings to unified format
    // Parse building geometries (buildings come as raw objects, not GeoJSON features)
    const unifiedFeatures = buildings.map((building: any) => {
      // Parse geometry if it's a string
      let geometry;
      try {
        geometry = typeof building.geometry === 'string' 
          ? JSON.parse(building.geometry)
          : building.geometry;
      } catch (e) {
        console.warn('Failed to parse building geometry:', e);
        return null;
      }

      if (!geometry) return null;

      // Find matching address by building_id or address_id
      const matchingAddress = addresses.find((addr: any) => {
        const addrId = addr.id;
        return addrId === building.address_id || addrId === building.building_id;
      });

      // Extract formatted address
      let fullAddress = 'Address not available';
      if (matchingAddress) {
        fullAddress = matchingAddress.formatted || matchingAddress.address || fullAddress;
      }

      return {
        type: 'Feature',
        geometry,
        properties: {
          building_id: building.building_id || building.id,
          gers_id: building.gers_id || building.source_id || building.building_id || building.id, // GERS ID for building-address bridge
          render_height: building.height_m || building.height || 10,
          full_address: fullAddress,
          campaign_name: campaignName,
          campaign_status: building.status || 'pending',
          // Keep legacy fields for backward compatibility
          address_id: building.address_id,
          height: building.height_m || building.height || 10,
          min_height: building.min_height_m || building.min_height || 0,
        },
      };
    }).filter((f): f is NonNullable<typeof f> => f !== null);

    // If no buildings but we have addresses, create 8-sided polygon buffers from address points
    // This ensures fill-extrusion has actual polygons to render, even without Overture footprints
    if (unifiedFeatures.length === 0 && addresses.length > 0) {
      // Import parsePointGeometry from addresses route
      const { parsePointGeometry } = await import('../addresses/route');

      addresses.forEach((addr: any) => {
        // Try to get coordinates from GeoJSON geometry (from campaign_addresses_geojson view)
        let pointGeom = null;
        
        // First, check if address already has GeoJSON geometry
        if (addr.geometry && typeof addr.geometry === 'object' && addr.geometry.type === 'Point') {
          pointGeom = addr.geometry;
        } else if (addr.geom_json && typeof addr.geom_json === 'object' && addr.geom_json.type === 'Point') {
          pointGeom = addr.geom_json;
        } else {
          // Fallback to parsing (handles WKB hex strings)
          pointGeom = parsePointGeometry(addr);
        }
        
        if (pointGeom && pointGeom.type === 'Point' && Array.isArray(pointGeom.coordinates) && pointGeom.coordinates.length >= 2) {
          const [lng, lat] = pointGeom.coordinates;
          
          // Create 8-sided polygon buffer (octagon) around the point
          // ~5.5 meters radius (0.00005 degrees at equator)
          const polygon = createOctagonBuffer(lng, lat, 0.00005);

          unifiedFeatures.push({
            type: 'Feature',
            geometry: polygon,
            properties: {
              building_id: addr.id,
              gers_id: addr.gers_id || addr.source_id || addr.id, // GERS ID for building-address bridge
              render_height: 10, // CRITICAL: Must have render_height for fill-extrusion to be visible
              full_address: addr.formatted || addr.address || 'Address not available',
              campaign_name: campaignName,
              campaign_status: addr.visited ? 'visited' : 'pending',
              address_id: addr.id,
              height: 10, // Also set height for backward compatibility
              min_height: 0,
            },
          });
        }
      });
    }

    return NextResponse.json({
      type: 'FeatureCollection',
      features: unifiedFeatures,
    });
  } catch (error) {
    console.error('Error fetching unified building data:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch unified building data',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
