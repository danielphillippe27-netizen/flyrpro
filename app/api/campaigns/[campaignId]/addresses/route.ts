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

type AddressGeometryInput = {
  geom_json?: unknown;
  geometry?: unknown;
  geom?: unknown;
  coordinate?: { lat?: unknown; lon?: unknown } | null;
};

function isPointGeometry(value: unknown): value is PointGeometry {
  if (!value || typeof value !== 'object') return false;
  const geom = value as { type?: unknown; coordinates?: unknown };
  return geom.type === 'Point' && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2;
}

function toPointGeometry(value: unknown): PointGeometry | null {
  if (isPointGeometry(value)) {
    const [lon, lat] = value.coordinates;
    if (typeof lon === 'number' && typeof lat === 'number') {
      return { type: 'Point', coordinates: [lon, lat] };
    }
  }
  return null;
}

function parsePointGeometry(address: AddressGeometryInput): PointGeometry | null {
  // NEW: Check for 'geom_json' field first (from Supabase view with ST_AsGeoJSON conversion)
  if (address.geom_json) {
    const geomJson = address.geom_json;
    if (typeof geomJson === 'object' && geomJson !== null) {
      const point = toPointGeometry(geomJson);
      if (point) return point;
    } else if (typeof geomJson === 'string') {
      try {
        const parsed = JSON.parse(geomJson);
        const point = toPointGeometry(parsed);
        if (point) return point;
      } catch {
        // Ignore parsing errors
      }
    }
  }
  
  // Check for 'geometry' field (from updated Supabase view)
  if (address.geometry) {
    if (typeof address.geometry === 'string') {
      try {
        const parsed = JSON.parse(address.geometry);
        const point = toPointGeometry(parsed) || toPointGeometry(parsed?.geometry);
        if (point) return point;
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
      const geom = address.geometry as { geometry?: unknown };
      const point = toPointGeometry(geom) || toPointGeometry(geom.geometry);
      if (point) return point;
    }
  }

  // LEGACY: Check for 'geom' field (backward compatibility)
  if (address.geom) {
    if (typeof address.geom === 'string') {
      // Check if it's WKB hex format (PostGIS binary)
      const isWKBHex = /^[0-9A-Fa-f]{16,}$/.test(address.geom) && (address.geom.startsWith('01') || address.geom.startsWith('00'));
      
      if (isWKBHex && address.geom.length >= 50) {
        try {
          // Parse WKB hex Point format (EWKB with SRID)
          // Format: [endian][type][SRID flag][SRID][lon][lat]
          // Header: 1 + 4 + 1 + 4 = 10 bytes = 20 hex chars
          const headerLength = 20;
          if (address.geom.length >= headerLength + 32) {
            const lonHex = address.geom.substring(headerLength, headerLength + 16);
            const latHex = address.geom.substring(headerLength + 16, headerLength + 32);
            
            // Convert hex to Buffer and parse as little-endian double
            const lonBuffer = Buffer.from(lonHex, 'hex');
            const latBuffer = Buffer.from(latHex, 'hex');
            
            const lon = lonBuffer.readDoubleLE(0);
            const lat = latBuffer.readDoubleLE(0);
            
            if (!isNaN(lon) && !isNaN(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90) {
              return { type: 'Point', coordinates: [lon, lat] };
            }
          }
        } catch (wkbError) {
          // WKB parsing failed, continue to other formats
        }
      }
      
      try {
        const parsed = JSON.parse(address.geom);
        const point = toPointGeometry(parsed) || toPointGeometry(parsed?.geometry);
        if (point) return point;
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
      const geom = address.geom as { geometry?: unknown };
      const point = toPointGeometry(geom) || toPointGeometry(geom.geometry);
      if (point) return point;
    }
  }

  // FALLBACK: Check for coordinate object
  if (
    address.coordinate &&
    typeof address.coordinate.lon === 'number' &&
    typeof address.coordinate.lat === 'number'
  ) {
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
  { params }: { params: Promise<{ campaignId: string }> }
) {
  try {
    const { campaignId } = await params;

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
