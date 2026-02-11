/**
 * Overture Service - Thin wrapper around MotherDuck HTTP API
 *
 * Legacy / script-only: app routes (provision, generate-address-list) use Tile Lambda + S3, not this service.
 * This service provides a simple interface for querying Overture Maps data
 * through the MotherDuck HTTP API. All data is pre-loaded into MotherDuck.
 *
 * Before using, run: npx tsx scripts/load-overture-to-motherduck.ts
 */

import { 
  MotherDuckHttpService,
  type OvertureBuilding,
  type OvertureAddress,
  type OvertureTransportation,
  type BoundingBox
} from './MotherDuckHttpService';

// Re-export types for consumers
export type { OvertureBuilding, OvertureAddress, OvertureTransportation, BoundingBox };

export class OvertureService {
  /**
   * Get buildings inside a polygon
   * Queries pre-loaded MotherDuck database via HTTP API
   */
  static async getBuildingsInPolygon(input: any): Promise<OvertureBuilding[]> {
    console.log('[OvertureService] getBuildingsInPolygon via MotherDuck HTTP');
    return MotherDuckHttpService.getBuildingsInPolygon(input);
  }

  /**
   * Get addresses inside a polygon
   * Queries pre-loaded MotherDuck database via HTTP API
   */
  static async getAddressesInPolygon(input: any): Promise<OvertureAddress[]> {
    console.log('[OvertureService] getAddressesInPolygon via MotherDuck HTTP');
    return MotherDuckHttpService.getAddressesInPolygon(input);
  }

  /**
   * Get roads inside a polygon
   * Note: Roads are not pre-loaded, returns empty array
   */
  static async getRoadsInPolygon(input: any): Promise<OvertureTransportation[]> {
    console.log('[OvertureService] getRoadsInPolygon via MotherDuck HTTP');
    return MotherDuckHttpService.getRoadsInPolygon(input);
  }

  /**
   * Get nearest addresses to a point
   * Creates a bbox around the point and queries MotherDuck, then sorts by distance
   */
  static async getNearestHomes(lat: number, lng: number, limit: number = 50): Promise<OvertureAddress[]> {
    console.log(`[OvertureService] getNearestHomes at ${lat}, ${lng} (limit: ${limit})`);
    
    // Create a bbox around the point (~2km radius)
    const radiusKm = 2;
    const latDelta = radiusKm / 111;
    const lngDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
    
    // Create a simple polygon (rectangle) for the bbox query
    const polygon = {
      type: 'Polygon',
      coordinates: [[
        [lng - lngDelta, lat - latDelta],
        [lng + lngDelta, lat - latDelta],
        [lng + lngDelta, lat + latDelta],
        [lng - lngDelta, lat + latDelta],
        [lng - lngDelta, lat - latDelta],
      ]]
    };
    
    // Get addresses in the bbox
    const addresses = await MotherDuckHttpService.getAddressesInPolygon(polygon);
    
    // Calculate distance and sort
    const withDistance = addresses.map(addr => {
      const [addrLng, addrLat] = addr.geometry?.coordinates || [0, 0];
      const distance = Math.sqrt(
        Math.pow((addrLat - lat) * 111, 2) + 
        Math.pow((addrLng - lng) * 111 * Math.cos(lat * Math.PI / 180), 2)
      );
      return { ...addr, distance };
    });
    
    // Sort by distance and take top N
    withDistance.sort((a, b) => a.distance - b.distance);
    const result = withDistance.slice(0, limit);
    
    console.log(`[OvertureService] Found ${result.length} nearest addresses`);
    return result;
  }

  /**
   * Reverse geocode a lat/lon coordinate using Mapbox Geocoding API
   * Used to find addresses for orphan buildings
   */
  static async reverseGeocode(lat: number, lon: number): Promise<{
    house_number: string;
    street_name: string;
    postal_code: string;
    formatted_address: string;
  } | null> {
    const token = process.env.MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    
    if (!token) {
      console.warn('[OvertureService] MAPBOX_TOKEN not set, skipping reverse geocode');
      return null;
    }

    try {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json?types=address&access_token=${token}`;
      
      console.log(`[OvertureService] Reverse geocoding: ${lat}, ${lon}`);
      
      const res = await fetch(url);
      
      if (!res.ok) {
        console.error(`[OvertureService] Mapbox API error: ${res.status} ${res.statusText}`);
        return null;
      }
      
      const data = await res.json();
      
      if (!data.features?.length) {
        console.log(`[OvertureService] No address found at ${lat}, ${lon}`);
        return null;
      }
      
      const feature = data.features[0];
      const postcode = feature.context?.find((c: any) => c.id?.startsWith('postcode'))?.text || '';
      
      const result = {
        house_number: feature.address || '',
        street_name: feature.text || '',
        postal_code: postcode,
        formatted_address: feature.place_name || '',
      };
      
      console.log(`[OvertureService] Reverse geocoded: ${result.formatted_address}`);
      
      return result;
    } catch (error) {
      console.error('[OvertureService] Reverse geocode error:', error);
      return null;
    }
  }
}
