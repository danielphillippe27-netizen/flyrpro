import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { BuildingService } from '@/lib/services/BuildingService';
import { MapService } from '@/lib/services/MapService';
import { MapBuildingsService } from '@/lib/services/MapBuildingsService';

export const runtime = 'nodejs';

/**
 * GET endpoint for fetching campaign buildings as GeoJSON
 * Returns buildings with geometry for the specified campaign
 * Priority: map_buildings (for fill-extrusion) > buildings > campaign_buildings
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

    // Priority 1: Try map_buildings table (for fill-extrusion visualization)
    let buildings: any[] = [];
    try {
      const mapBuildings = await MapBuildingsService.fetchCampaignBuildings(campaignId);
      if (mapBuildings.length > 0) {
        buildings = mapBuildings;
      }
    } catch (error) {
      console.warn('Error fetching from map_buildings, trying fallback:', error);
    }

    // Priority 2: Fallback to GERS buildings (buildings table)
    if (buildings.length === 0) {
      try {
        buildings = await BuildingService.fetchCampaignBuildings(campaignId);
      } catch (error) {
        console.warn('Error fetching from buildings table:', error);
      }
    }

    // Priority 3: Fallback to legacy campaign_buildings
    if (buildings.length === 0) {
      try {
        buildings = await MapService.fetchCampaignBuildings(campaignId);
      } catch (error) {
        console.warn('Error fetching from campaign_buildings:', error);
      }
    }

    // Transform to GeoJSON features
    const features = buildings.map((building: any) => {
      let geometry;
      try {
        // Handle different geometry field names
        let geomData = building.geom || building.geometry;
        
        // Parse geometry if it's a string
        if (typeof geomData === 'string') {
          geometry = JSON.parse(geomData);
        } else if (geomData) {
          geometry = geomData;
        } else {
          console.warn('Building has no geometry:', building.id);
          return null;
        }
      } catch (e) {
        console.warn('Failed to parse building geometry:', e);
        return null;
      }

      return {
        type: 'Feature',
        geometry,
        properties: {
          id: building.id,
          building_id: building.building_id || building.id,
          address_id: building.address_id,
          gers_id: building.gers_id || building.source_id || null, // GERS ID for building-address bridge
          // Building height in meters from map_buildings table (for fill-extrusion)
          height_m: building.height_m || building.height || 10,
          min_height: building.min_height_m || building.min_height || 0,
          front_bearing: building.front_bearing || 0,
          source: building.source || 'unknown',
        },
      };
    }).filter((f): f is NonNullable<typeof f> => f !== null);

    // Return as FeatureCollection for Mapbox
    return NextResponse.json({
      type: 'FeatureCollection',
      features,
    });
  } catch (error) {
    console.error('Error fetching campaign buildings:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch building data',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
