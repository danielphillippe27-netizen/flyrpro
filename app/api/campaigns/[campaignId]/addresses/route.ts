import { NextRequest, NextResponse } from 'next/server';
import { CampaignsService } from '@/lib/services/CampaignsService';

type PointGeometry = {
  type: 'Point';
  coordinates: [number, number];
};

const WKT_POINT_PATTERNS = [
  /POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i,
  /POINT\s*\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/i,
  /SRID=\d+;POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i,
];

function parsePointGeometry(address: any): PointGeometry | null {
  // NEW: Check for 'geometry' field first (from updated Supabase view)
  if (address.geometry) {
    if (typeof address.geometry === 'string') {
      try {
        const parsed = JSON.parse(address.geometry);
        if (parsed?.type === 'Point' && Array.isArray(parsed.coordinates)) {
          return { type: 'Point', coordinates: [parsed.coordinates[0], parsed.coordinates[1]] };
        }
        if (Array.isArray(parsed?.coordinates) && parsed.coordinates.length >= 2) {
          return { type: 'Point', coordinates: [parsed.coordinates[0], parsed.coordinates[1]] };
        }
        if (parsed?.geometry?.coordinates && parsed.geometry.coordinates.length >= 2) {
          return { type: 'Point', coordinates: [parsed.geometry.coordinates[0], parsed.geometry.coordinates[1]] };
        }
      } catch {
        // Try WKT parsing if JSON parse fails
        for (const pattern of WKT_POINT_PATTERNS) {
          const match = address.geometry.match(pattern);
          if (match) {
            const lon = parseFloat(match[1]);
            const lat = parseFloat(match[2]);
            if (!isNaN(lon) && !isNaN(lat)) {
              return { type: 'Point', coordinates: [lon, lat] };
            }
          }
        }
      }
    } else if (typeof address.geometry === 'object') {
      const geom = address.geometry;
      if (geom?.type === 'Point' && Array.isArray(geom.coordinates)) {
        return { type: 'Point', coordinates: [geom.coordinates[0], geom.coordinates[1]] };
      }
      if (Array.isArray(geom?.coordinates) && geom.coordinates.length >= 2) {
        return { type: 'Point', coordinates: [geom.coordinates[0], geom.coordinates[1]] };
      }
      if (geom?.geometry?.coordinates && geom.geometry.coordinates.length >= 2) {
        return { type: 'Point', coordinates: [geom.geometry.coordinates[0], geom.geometry.coordinates[1]] };
      }
    }
  }

  // LEGACY: Check for 'geom' field (backward compatibility)
  if (address.geom) {
    if (typeof address.geom === 'string') {
      try {
        const parsed = JSON.parse(address.geom);
        if (parsed?.type === 'Point' && Array.isArray(parsed.coordinates)) {
          return { type: 'Point', coordinates: [parsed.coordinates[0], parsed.coordinates[1]] };
        }
        if (Array.isArray(parsed?.coordinates) && parsed.coordinates.length >= 2) {
          return { type: 'Point', coordinates: [parsed.coordinates[0], parsed.coordinates[1]] };
        }
        if (parsed?.geometry?.coordinates && parsed.geometry.coordinates.length >= 2) {
          return { type: 'Point', coordinates: [parsed.geometry.coordinates[0], parsed.geometry.coordinates[1]] };
        }
      } catch {
        for (const pattern of WKT_POINT_PATTERNS) {
          const match = address.geom.match(pattern);
          if (match) {
            const lon = parseFloat(match[1]);
            const lat = parseFloat(match[2]);
            if (!isNaN(lon) && !isNaN(lat)) {
              return { type: 'Point', coordinates: [lon, lat] };
            }
          }
        }
      }
    } else if (typeof address.geom === 'object') {
      const geom = address.geom;
      if (geom?.type === 'Point' && Array.isArray(geom.coordinates)) {
        return { type: 'Point', coordinates: [geom.coordinates[0], geom.coordinates[1]] };
      }
      if (Array.isArray(geom?.coordinates) && geom.coordinates.length >= 2) {
        return { type: 'Point', coordinates: [geom.coordinates[0], geom.coordinates[1]] };
      }
      if (geom?.geometry?.coordinates && geom.geometry.coordinates.length >= 2) {
        return { type: 'Point', coordinates: [geom.geometry.coordinates[0], geom.geometry.coordinates[1]] };
      }
    }
  }

  // FALLBACK: Check for coordinate object
  if (address.coordinate) {
    return {
      type: 'Point',
      coordinates: [address.coordinate.lon, address.coordinate.lat],
    };
  }

  return null;
}

export const runtime = 'nodejs';

/**
 * GET endpoint for fetching campaign addresses as GeoJSON
 * Returns addresses with Point geometry for the specified campaign
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { campaignId: string } }
) {
  try {
    const { campaignId } = params;

    // DEBUG: Log campaign ID
    console.log(`[API] Received request for campaign: ${campaignId}`);

    if (!campaignId) {
      console.error('[API] Missing campaignId parameter');
      return NextResponse.json({ error: 'campaignId is required' }, { status: 400 });
    }

    // Fetch addresses from the service
    const addresses = await CampaignsService.fetchAddresses(campaignId);

    // DEBUG: Log count and first row structure
    console.log(`[API] Fetched ${addresses.length} addresses from Supabase for campaign ${campaignId}`);
    if (addresses.length > 0) {
      console.log('[API] First address row structure:', {
        keys: Object.keys(addresses[0]),
        hasGeometry: 'geometry' in addresses[0],
        hasGeom: 'geom' in addresses[0],
        geometryType: typeof addresses[0].geometry,
        geomType: typeof addresses[0].geom,
        geometrySample: addresses[0].geometry ? JSON.stringify(addresses[0].geometry).substring(0, 200) : 'N/A',
        geomSample: addresses[0].geom ? JSON.stringify(addresses[0].geom).substring(0, 200) : 'N/A',
      });
    }

    // Transform to GeoJSON features with Point geometry
    // Handles GeoJSON objects, GeoJSON strings, and WKT POINT strings
    const features = addresses
      .map((address) => {
        const geometry = parsePointGeometry(address);
        if (!geometry) {
          return null;
        }

        return {
          type: 'Feature',
          geometry,
          properties: {
            id: address.id,
            formatted: address.formatted || address.address || '',
            visited: address.visited || false,
            house_bearing: address.house_bearing || 0,
            road_bearing: address.road_bearing || 0,
          },
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);

    // DEBUG: Log how many features were successfully parsed
    console.log(`[API] Successfully parsed ${features.length} features from ${addresses.length} addresses`);
    if (features.length === 0 && addresses.length > 0) {
      console.warn('[API] WARNING: All addresses failed geometry parsing. Sample address:', addresses[0]);
    }

    return NextResponse.json(features);
  } catch (error) {
    console.error('Error fetching campaign addresses:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch address data',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
