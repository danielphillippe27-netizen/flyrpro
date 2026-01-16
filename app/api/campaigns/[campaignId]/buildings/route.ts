import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { BuildingService } from '@/lib/services/BuildingService';
import { MapService } from '@/lib/services/MapService';

export const runtime = 'nodejs';

/**
 * GET endpoint for fetching campaign buildings as GeoJSON
 * Returns buildings with geometry for the specified campaign
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

    // Try to fetch GERS buildings first (Gold Standard)
    let buildings = await BuildingService.fetchCampaignBuildings(campaignId);
    
    // Fallback to legacy campaign_buildings
    if (buildings.length === 0) {
      buildings = await MapService.fetchCampaignBuildings(campaignId);
    }

    // Transform to GeoJSON features
    const features = buildings.map((building: any) => {
      let geometry;
      try {
        // Parse geometry if it's a string
        geometry = typeof building.geometry === 'string' 
          ? JSON.parse(building.geometry)
          : building.geometry;
      } catch (e) {
        console.warn('Failed to parse building geometry:', e);
        return null;
      }

      return {
        type: 'Feature',
        geometry,
        properties: {
          id: building.id,
          building_id: building.building_id,
          address_id: building.address_id,
          height: building.height_m || 10,
          min_height: building.min_height_m || 0,
          front_bearing: building.front_bearing || 0,
          source: building.source,
        },
      };
    }).filter((f): f is NonNullable<typeof f> => f !== null);

    return NextResponse.json(features);
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
