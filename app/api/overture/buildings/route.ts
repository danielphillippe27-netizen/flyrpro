import { NextRequest, NextResponse } from 'next/server';
import { OvertureService, type BoundingBox } from '@/lib/services/OvertureService';

// FIX: Ensure Node.js runtime (MotherDuck/DuckDB requires Node, not Edge)
export const runtime = 'nodejs';

/**
 * GET endpoint for fetching Overture building data as GeoJSON
 * Thin route that delegates to OvertureService
 */
export async function GET(request: NextRequest) {
  try {
    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const minx = parseFloat(searchParams.get('minx') || '-78.700');
    const miny = parseFloat(searchParams.get('miny') || '43.900');
    const maxx = parseFloat(searchParams.get('maxx') || '-78.670');
    const maxy = parseFloat(searchParams.get('maxy') || '43.920');

    // Create bounding box
    const bbox: BoundingBox = {
      west: minx,
      south: miny,
      east: maxx,
      north: maxy,
    };

    // Use OvertureService to extract buildings
    const buildings = await OvertureService.extractBuildings(bbox);

    // Transform results to GeoJSON FeatureCollection
    const features = buildings.map((building) => {
      // Extract centroid coordinates
      const centroidCoords = building.centroid?.coordinates || [0, 0];
      const [centroidLng, centroidLat] = centroidCoords;

      return {
        type: 'Feature',
        geometry: building.geometry,
        properties: {
          id: building.gers_id || '',
          height: building.height || null,
          name: building.house_name || null,
          centroid: [centroidLng, centroidLat], // [lng, lat]
        },
      };
    });

    return NextResponse.json({
      type: 'FeatureCollection',
      features,
    });
  } catch (error) {
    console.error('Error fetching Overture buildings:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch building data',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
